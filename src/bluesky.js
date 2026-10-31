// Integração com o Bluesky (AT Protocol), usando handle + senha de app.

import { BLUESKY_MAX, MENTION_RE, buildFacets, splitIntoThread } from './text.js';

const ENTRYWAY = 'https://bsky.social';
const KV_KEY = 'bsky:session';

class XrpcError extends Error {
  constructor(status, code, message) {
    super(`Bluesky: ${message || code || `HTTP ${status}`}`);
    this.status = status;
    this.code = code;
  }
}

async function xrpc(base, method, { token, json, body, headers = {}, get = false } = {}) {
  const init = { method: get ? 'GET' : 'POST', headers: { ...headers } };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (json !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(json);
  } else if (body !== undefined) {
    init.body = body;
  }
  const res = await fetch(`${base}/xrpc/${method}`, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new XrpcError(res.status, data.error, data.message);
  return data;
}

function pdsFrom(session) {
  const svc = session.didDoc?.service?.find((s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer');
  return svc?.serviceEndpoint || ENTRYWAY;
}

async function saveSession(env, data) {
  const session = {
    accessJwt: data.accessJwt,
    refreshJwt: data.refreshJwt,
    did: data.did,
    handle: data.handle,
    pds: pdsFrom(data),
  };
  await env.KV.put(KV_KEY, JSON.stringify(session));
  return session;
}

async function login(env) {
  if (!env.BLUESKY_HANDLE || !env.BLUESKY_APP_PASSWORD) {
    throw new Error('Bluesky não configurado: faltam BLUESKY_HANDLE e BLUESKY_APP_PASSWORD.');
  }
  const data = await xrpc(ENTRYWAY, 'com.atproto.server.createSession', {
    json: { identifier: env.BLUESKY_HANDLE.replace(/^@/, ''), password: env.BLUESKY_APP_PASSWORD },
  });
  return saveSession(env, data);
}

async function refresh(env, session) {
  try {
    const data = await xrpc(session.pds, 'com.atproto.server.refreshSession', { token: session.refreshJwt });
    return saveSession(env, { ...data, didDoc: data.didDoc || { service: [{ id: '#atproto_pds', serviceEndpoint: session.pds }] } });
  } catch {
    return login(env);
  }
}

async function getSession(env) {
  const raw = await env.KV.get(KV_KEY);
  return raw ? JSON.parse(raw) : login(env);
}

/** Executa uma chamada autenticada, renovando a sessão se ela tiver expirado. */
async function withSession(env, fn) {
  let session = await getSession(env);
  try {
    return await fn(session);
  } catch (err) {
    if (err instanceof XrpcError && (err.code === 'ExpiredToken' || err.code === 'InvalidToken' || err.status === 401)) {
      session = await refresh(env, session);
      return fn(session);
    }
    throw err;
  }
}

export async function status(env) {
  if (!env.BLUESKY_HANDLE || !env.BLUESKY_APP_PASSWORD) return { connected: false, reason: 'not_configured' };
  try {
    const session = await withSession(env, async (s) => {
      await xrpc(s.pds, 'com.atproto.server.getSession', { token: s.accessJwt, get: true });
      return s;
    });
    return { connected: true, handle: session.handle };
  } catch (err) {
    return { connected: false, reason: err.message };
  }
}

/** Envia um arquivo do R2 direto para o servidor do Bluesky, sem carregar tudo na memória. */
async function uploadFromR2(env, session, item) {
  const obj = await env.MEDIA.get(item.key);
  if (!obj) throw new Error(`Bluesky: arquivo ${item.key} não encontrado.`);
  const { readable, writable } = new FixedLengthStream(obj.size);
  obj.body.pipeTo(writable).catch(() => { /* o erro aparece no upload abaixo */ });
  const data = await xrpc(session.pds, 'com.atproto.repo.uploadBlob', {
    token: session.accessJwt,
    body: readable,
    headers: { 'Content-Type': obj.httpMetadata?.contentType || item.mime || 'application/octet-stream' },
  });
  return data.blob;
}

function aspect(item) {
  return item.width && item.height ? { width: Math.round(item.width), height: Math.round(item.height) } : undefined;
}

async function buildEmbed(env, session, media) {
  if (!media.length) return { embed: undefined, note: null };
  const video = media.find((m) => m.kind === 'video');
  if (video) {
    const blob = await uploadFromR2(env, session, video);
    return {
      embed: { $type: 'app.bsky.embed.video', video: blob, alt: video.alt || undefined, aspectRatio: aspect(video) },
      note: media.length > 1 ? 'O Bluesky aceita 1 vídeo por post; só o vídeo foi enviado.' : null,
    };
  }
  const images = [];
  for (const img of media.slice(0, 4)) {
    const blob = await uploadFromR2(env, session, img);
    images.push({ image: blob, alt: img.alt || '', aspectRatio: aspect(img) });
  }
  return {
    embed: { $type: 'app.bsky.embed.images', images },
    note: media.length > 4 ? 'O Bluesky aceita até 4 fotos por post; foram enviadas as 4 primeiras.' : null,
  };
}

// ---------- Card de link (prévia) ----------
// O Bluesky não monta a prévia de links sozinho: quem publica envia título,
// descrição e miniatura. Usado quando o post não tem foto nem vídeo.

export const UA = 'Mozilla/5.0 (compatible; NasQuadrasOnline/1.0; +https://nasquadras.online)';
export const THUMB_MAX = 950_000; // limite de ~1 MB do Bluesky para a miniatura

export const decodeHtml = (s) => String(s || '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

export function firstUrl(text) {
  const m = String(text || '').match(/https?:\/\/[^\s<>"']+/);
  return m ? m[0].replace(/[.,;:!?)\]]+$/, '') : null;
}

export async function pageMeta(url) {
  // YouTube: o oEmbed é mais confiável que a página (sem tela de consentimento).
  if (/^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(url)) {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { headers: { 'User-Agent': UA } });
    if (r.ok) {
      const o = await r.json();
      return { title: o.title, description: o.author_name ? `YouTube · ${o.author_name}` : 'YouTube', image: o.thumbnail_url, finalUrl: url };
    }
  }
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow' });
  if (!res.ok || !(res.headers.get('Content-Type') || '').includes('html')) return null;
  const meta = {};
  let title = '';
  await new HTMLRewriter()
    .on('meta', {
      element(e) {
        const k = (e.getAttribute('property') || e.getAttribute('name') || '').toLowerCase();
        const c = e.getAttribute('content');
        if (k && c && !(k in meta)) meta[k] = c;
      },
    })
    .on('title', { text(t) { title += t.text; } })
    .transform(res).arrayBuffer();
  let image = meta['og:image'] || meta['twitter:image'] || meta['twitter:image:src'] || null;
  if (image) { try { image = new URL(image, url).toString(); } catch { image = null; } }
  return {
    title: meta['og:title'] || meta['twitter:title'] || title,
    description: meta['og:description'] || meta.description || '',
    image,
    finalUrl: res.url || url,
  };
}

/** Monta o embed de link. Qualquer falha devolve null (o post sai sem card). */
export async function linkCard(env, session, url) {
  try {
    const m = await pageMeta(url);
    if (!m) return null;
    const external = {
      uri: url,
      title: decodeHtml(m.title).slice(0, 300) || new URL(url).hostname,
      description: decodeHtml(m.description).slice(0, 1000),
    };
    if (m.image && /^https:\/\//.test(m.image)) {
      try {
        const img = await fetch(m.image, { headers: { 'User-Agent': UA } });
        const type = (img.headers.get('Content-Type') || '').split(';')[0];
        if (img.ok && type.startsWith('image/')) {
          const buf = await img.arrayBuffer();
          if (buf.byteLength <= THUMB_MAX) {
            const up = await xrpc(session.pds, 'com.atproto.repo.uploadBlob', {
              token: session.accessJwt, body: buf, headers: { 'Content-Type': type },
            });
            external.thumb = up.blob;
          }
        }
      } catch { /* card sem miniatura */ }
    }
    return { $type: 'app.bsky.embed.external', external };
  } catch {
    return null;
  }
}

/** @fulano.bsky.social -> DID, para a menção virar link para o perfil. */
async function resolveMentions(session, text) {
  const dids = {};
  const handles = [...new Set([...String(text).matchAll(MENTION_RE)].map((m) => m[2].toLowerCase()))].slice(0, 10);
  await Promise.all(handles.map(async (h) => {
    try {
      const r = await xrpc(session.pds, `com.atproto.identity.resolveHandle?handle=${encodeURIComponent(h)}`, { token: session.accessJwt, get: true });
      if (r.did) dids[h] = r.did;
    } catch { /* não é um perfil do Bluesky: fica como texto */ }
  }));
  return dids;
}

const webUrl = (handle, uri) => `https://bsky.app/profile/${handle}/post/${uri.split('/').pop()}`;

/**
 * Publica no Bluesky. Texto acima de 300 caracteres vira um fio numerado.
 * Com `replyTo` ({ root, parent }), o post entra como resposta num fio existente.
 * Devolve também `root` e `last` para o fio continuar no próximo post.
 */
export async function post(env, { text, media = [], langs = ['pt'], replyTo = null }) {
  return withSession(env, async (session) => {
    const parts = splitIntoThread(text || '', BLUESKY_MAX);
    let { embed, note } = await buildEmbed(env, session, media);
    // Sem foto/vídeo: o 1º link do post ganha o card de prévia.
    if (!embed) {
      const url = firstUrl(parts[0]);
      if (url) embed = (await linkCard(env, session, url)) || undefined;
    }
    const dids = await resolveMentions(session, text || '');

    let root = replyTo?.root || null;
    let parent = replyTo?.parent || null;
    let firstUri = null;

    for (let i = 0; i < parts.length; i++) {
      const record = {
        $type: 'app.bsky.feed.post',
        text: parts[i],
        createdAt: new Date().toISOString(),
        langs,
      };
      const facets = buildFacets(parts[i], dids);
      if (facets.length) record.facets = facets;
      if (i === 0 && embed) record.embed = embed;
      if (parent) record.reply = { root, parent };

      const res = await xrpc(session.pds, 'com.atproto.repo.createRecord', {
        token: session.accessJwt,
        json: { repo: session.did, collection: 'app.bsky.feed.post', record },
      });
      const ref = { uri: res.uri, cid: res.cid };
      if (!root) root = ref;
      if (!firstUri) firstUri = res.uri;
      parent = ref;
    }

    return {
      url: webUrl(session.handle, firstUri),
      parts: parts.length,
      note,
      root,
      last: parent,
      rootUrl: webUrl(session.handle, root.uri),
    };
  });
}
