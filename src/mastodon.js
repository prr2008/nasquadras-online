// Mastodon (mastodon.social): publicação com o token de acesso da conta.
// Até 500 caracteres por post (acima disso, vira um fio numerado), até 4 fotos
// ou 1 vídeo. No fio da cobertura, só o 1º post sai público; as respostas saem
// "não listadas" (quem segue vê, mas não enchem as linhas do tempo públicas).

import { splitIntoThread, graphemeLength } from './text.js';

export const MASTODON_MAX = 500;
const STATUS_KEY = 'mastodon:account';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const base = (env) => String(env.MASTODON_INSTANCE || 'https://mastodon.social').replace(/\/+$/, '');
export const configured = (env) => Boolean(env.MASTODON_TOKEN);

async function call(env, method, path, { json, form } = {}) {
  const headers = { Authorization: `Bearer ${env.MASTODON_TOKEN}` };
  let body;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  if (method === 'POST' && json) headers['Idempotency-Key'] = crypto.randomUUID();
  const res = await fetch(`${base(env)}${path}`, { method, headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) throw new Error('Mastodon: token inválido ou revogado. Gere outro e atualize MASTODON_TOKEN na Cloudflare.');
    if (res.status === 403) throw new Error('Mastodon: o token não tem permissão (marque write:statuses e write:media).');
    throw new Error(`Mastodon: ${data.error || `HTTP ${res.status}`}`);
  }
  return { status: res.status, data };
}

/** Conta conectada (guardada por 6 horas para não consultar a cada abertura do app). */
export async function status(env) {
  if (!configured(env)) return { configured: false, connected: false };
  const cached = JSON.parse((await env.KV.get(STATUS_KEY)) || 'null');
  if (cached?.token === env.MASTODON_TOKEN.slice(-6)) return { configured: true, connected: true, acct: cached.acct, url: cached.url };
  try {
    const { data } = await call(env, 'GET', '/api/v1/accounts/verify_credentials');
    const host = new URL(base(env)).hostname;
    const info = { token: env.MASTODON_TOKEN.slice(-6), acct: `${data.acct}@${host}`, url: data.url };
    await env.KV.put(STATUS_KEY, JSON.stringify(info), { expirationTtl: 6 * 3600 });
    return { configured: true, connected: true, acct: info.acct, url: info.url };
  } catch (err) {
    return { configured: true, connected: false, reason: err.message };
  }
}

/** Mastodon aceita até 4 fotos, ou 1 vídeo sozinho. */
export function pickMedia(media = []) {
  const video = media.find((m) => m.kind === 'video');
  return video ? [video] : media.filter((m) => m.kind === 'image').slice(0, 4);
}

async function uploadOne(env, item) {
  const obj = await env.MEDIA.get(item.key);
  if (!obj) throw new Error('Mastodon: mídia não encontrada no armazenamento.');
  const form = new FormData();
  const type = item.mime || obj.httpMetadata?.contentType || (item.kind === 'video' ? 'video/mp4' : 'image/jpeg');
  form.append('file', new File([await obj.arrayBuffer()], item.key, { type }));
  if (item.alt) form.append('description', String(item.alt).slice(0, 1500));
  const { status, data } = await call(env, 'POST', '/api/v2/media', { form });
  // 202: o servidor ainda está processando (vídeo); espera ficar pronto.
  if (status === 202 || !data.url) {
    for (let i = 0; i < 40; i++) {
      await sleep(item.kind === 'video' ? 3000 : 1000);
      const r = await call(env, 'GET', `/api/v1/media/${data.id}`);
      if (r.status === 200 && r.data.url) break;
      if (i === 39) throw new Error('Mastodon: o vídeo demorou demais para processar.');
    }
  }
  return data.id;
}

/**
 * Publica. `replyToId` encaixa o post no fio; `visibility` padrão: público no
 * 1º post e não listado nas respostas. Devolve o 1º e o último post (para o fio).
 */
export async function post(env, { text, media = [], replyToId = null }) {
  if (!configured(env)) throw new Error('Mastodon não configurado: cadastre MASTODON_TOKEN na Cloudflare.');
  const items = pickMedia(media);
  const mediaIds = [];
  for (const it of items) mediaIds.push(await uploadOne(env, it));
  const parts = graphemeLength(text) > MASTODON_MAX ? splitIntoThread(text, MASTODON_MAX) : [text];
  let parent = replyToId;
  let first = null;
  let last = null;
  for (let i = 0; i < parts.length; i++) {
    const { data } = await call(env, 'POST', '/api/v1/statuses', {
      json: {
        status: parts[i],
        media_ids: i === 0 ? mediaIds : [],
        in_reply_to_id: parent || undefined,
        visibility: parent ? 'unlisted' : 'public',
        language: 'pt',
      },
    });
    if (!first) first = data;
    last = data;
    parent = data.id;
  }
  const note = media.length > items.length ? 'Mastodon: foram só as 4 primeiras fotos (ou só o vídeo).' : undefined;
  return { id: first.id, url: first.url, lastId: last.id, parts: parts.length, note };
}
