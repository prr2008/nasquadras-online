// Google Docs → blog. O script instalado no documento-modelo do Google Docs
// (public/gdocs/NasQuadras.gs) envia o texto já convertido em HTML, com as
// fotos, para /api/gdocs/*, autenticado por um código de conexão gerado no app.

import { safeEqual } from './auth.js';
import * as blog from './blog.js';
import * as threads from './threads.js';
import * as bluesky from './bluesky.js';

const TOKEN_KEY = 'gdocs:token';
const docKey = (docId) => `gdocs:doc:${docId}`;
const IMG_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_IMAGE = 15 * 1024 * 1024;
const MAX_IMAGES = 40;

const enc = new TextEncoder();
async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- Código de conexão ----------

/** Gera um código novo (o anterior deixa de valer). O app mostra uma vez só. */
export async function newToken(env) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  await env.KV.put(TOKEN_KEY, JSON.stringify({ hash: await sha256(token), createdAt: Date.now(), lastUsed: null }));
  return token;
}

export async function revoke(env) {
  await env.KV.delete(TOKEN_KEY);
}

export async function status(env) {
  const t = JSON.parse((await env.KV.get(TOKEN_KEY)) || 'null');
  return t ? { connected: true, createdAt: t.createdAt, lastUsed: t.lastUsed } : { connected: false };
}

/** Confere o "Authorization: Bearer <código>" enviado pelo Google Docs. */
export async function checkToken(env, request) {
  const m = (request.headers.get('Authorization') || '').match(/^Bearer\s+([0-9a-f]{64})$/i);
  if (!m) return false;
  const t = JSON.parse((await env.KV.get(TOKEN_KEY)) || 'null');
  if (!t || !safeEqual(await sha256(m[1].toLowerCase()), t.hash)) return false;
  if (!t.lastUsed || Date.now() - t.lastUsed > 3600e3) {
    await env.KV.put(TOKEN_KEY, JSON.stringify({ ...t, lastUsed: Date.now() }));
  }
  return true;
}

// ---------- Documento ↔ artigo ----------

const validDocId = (id) => /^[\w-]{20,100}$/.test(String(id || ''));

async function linkedArticle(env, docId) {
  const id = Number(await env.KV.get(docKey(docId)));
  return id ? blog.getArticleById(env, id) : null;
}

function summaryOf(a, { site, app }) {
  if (!a) return null;
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    summary: a.summary,
    category: a.category,
    status: a.status,
    published_at: a.published_at,
    updated_at: a.updated_at,
    hasCover: Boolean(a.cover_key),
    url: `${site}/blog/${a.slug}`,
    editUrl: `${app}/app#blog/${a.id}`,
  };
}

/** O que o painel do Docs mostra ao abrir: artigo vinculado e categorias. */
export async function info(env, { docId }, base) {
  if (!validDocId(docId)) throw new Error('Documento inválido.');
  return { article: summaryOf(await linkedArticle(env, docId), base), categories: blog.CATEGORIES };
}

const EMBED = [
  [/^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch\?(?:.*&)?v=([\w-]{6,})/i, (id) => `https://www.youtube-nocookie.com/embed/${id}`],
  [/^https?:\/\/youtu\.be\/([\w-]{6,})/i, (id) => `https://www.youtube-nocookie.com/embed/${id}`],
  [/^https?:\/\/(?:www\.)?youtube\.com\/(?:shorts|live)\/([\w-]{6,})/i, (id) => `https://www.youtube-nocookie.com/embed/${id}`],
  [/^https?:\/\/(?:www\.)?vimeo\.com\/(\d+)/i, (id) => `https://player.vimeo.com/video/${id}`],
  [/^https?:\/\/open\.spotify\.com\/(?:intl-[a-z]+\/)?(episode|show|track|playlist|album)\/(\w+)/i, (kind, id) => `https://open.spotify.com/embed/${kind}/${id}`],
];

/** Um link do YouTube/Vimeo/Spotify sozinho num parágrafo vira o vídeo/player. */
export function embedLoneLinks(html) {
  return html.replace(/<p>\s*<a href="([^"]+)"[^>]*>[^<]*<\/a>\s*<\/p>/g, (whole, href) => {
    const url = href.replace(/&amp;/g, '&');
    for (const [re, make] of EMBED) {
      const m = url.match(re);
      if (m) return `<iframe src="${make(...m.slice(1))}"></iframe>`;
    }
    return whole;
  });
}

function b64ToBytes(b64) {
  const bin = atob(String(b64).replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Guarda as fotos do documento no R2 e devolve { idDoDocumento: chave }. */
async function storeImages(env, images) {
  const keys = {};
  for (const img of (Array.isArray(images) ? images : []).slice(0, MAX_IMAGES)) {
    const id = String(img?.id || '');
    const mime = String(img?.mime || '').toLowerCase();
    const ext = IMG_EXT[mime];
    if (!/^[\w-]{1,40}$/.test(id) || !ext || !img.data) continue;
    const bytes = b64ToBytes(img.data);
    if (!bytes.length || bytes.length > MAX_IMAGE) continue;
    const key = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: mime } });
    keys[id] = key;
  }
  return keys;
}

/**
 * Recebe o documento do Google Docs e cria/atualiza o artigo vinculado a ele.
 * input: { docId, title, summary, category, html, images: [{id, mime, data}], cover, status, announce }
 */
export async function importDoc(env, input, base) {
  const { docId } = input;
  if (!validDocId(docId)) throw new Error('Documento inválido.');
  const title = String(input.title || '').trim();
  if (!title) throw new Error('O documento precisa de um título (use o estilo "Título" na primeira linha, ou dê um nome ao arquivo).');
  const status = input.status === 'published' ? 'published' : 'draft';

  const current = await linkedArticle(env, docId);
  if (current && current.status === 'published' && status === 'draft') {
    throw new Error('Este texto já está publicado. Use "Atualizar publicação" ou tire do ar pelo app.');
  }

  const keys = await storeImages(env, input.images);
  let html = String(input.html || '');
  // A foto escolhida como capa sai do corpo do texto.
  const coverId = input.cover && keys[input.cover] ? input.cover : null;
  if (coverId) html = html.replace(new RegExp(`<img[^>]*src="nq-img:${coverId}"[^>]*>`), '');
  html = html.replace(/src="nq-img:([\w-]+)"/g, (_, id) => (keys[id] ? `src="/m/${keys[id]}"` : 'src=""'));
  html = embedLoneLinks(html);

  const payload = {
    title,
    summary: input.summary != null ? String(input.summary) : (current?.summary || ''),
    category: blog.CATEGORIES.includes(input.category) ? input.category : (current?.category || 'Opinião'),
    cover_key: coverId ? keys[coverId] : (input.keepCover === false ? null : current?.cover_key || null),
    body_html: html,
    status,
  };

  const saved = current ? await blog.updateArticle(env, current.id, payload) : await blog.createArticle(env, payload);
  await env.KV.put(docKey(docId), String(saved.id));

  const firstPublish = status === 'published' && (!current || !current.published_at);
  let announced = null;
  if (firstPublish && input.announce) announced = await announce(env, `📝 Novo no blog: ${saved.title}\n\n${base.site}/blog/${saved.slug}`);

  return { article: summaryOf(saved, base), firstPublish, announced, images: Object.keys(keys).length };
}

// ---------- Divulgação no Threads e no Bluesky ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function threadsText(env, text) {
  const { containerId } = await threads.createContainers(env, { text });
  for (let i = 0; i < 10; i++) {
    const [s] = await threads.containerStatus(env, [containerId]);
    if (s?.status === 'FINISHED') break;
    if (s?.status === 'ERROR') throw new Error(s.error || 'erro no Threads');
    await sleep(1500);
  }
  return threads.publish(env, containerId);
}

export async function announce(env, text) {
  const [t, b] = await Promise.allSettled([threadsText(env, text), bluesky.post(env, { text })]);
  return {
    threads: t.status === 'fulfilled' ? (t.value.url || 'ok') : { error: t.reason?.message },
    bluesky: b.status === 'fulfilled' ? b.value.url : { error: b.reason?.message },
  };
}
