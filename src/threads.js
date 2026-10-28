// Integração com a API oficial do Threads (Meta).
// Fluxo de publicação: criar contêiner(es) -> aguardar processamento -> publicar.

const GRAPH = 'https://graph.threads.net';
const API = `${GRAPH}/v1.0`;
const KV_KEY = 'threads:auth';
// threads_manage_replies é necessária para responder (reply_to_id) e montar o fio.
const SCOPES = 'threads_basic,threads_content_publish,threads_manage_replies';

export const redirectUri = (origin) => `${origin}/auth/threads/callback`;

async function call(url, init = {}) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg = data.error?.error_user_msg || data.error?.message || `HTTP ${res.status}`;
    throw new Error(`Threads: ${msg}`);
  }
  return data;
}

const form = (obj) => new URLSearchParams(
  Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''),
);

// ---------- Autenticação ----------

export function authorizeUrl(env, origin, state) {
  const url = new URL('https://threads.net/oauth/authorize');
  url.search = form({
    client_id: env.THREADS_APP_ID,
    redirect_uri: redirectUri(origin),
    scope: SCOPES,
    response_type: 'code',
    state,
  }).toString();
  return url.toString();
}

export async function handleCallback(env, origin, code) {
  // 1) código -> token de curta duração
  const short = await call(`${GRAPH}/oauth/access_token`, {
    method: 'POST',
    body: form({
      client_id: env.THREADS_APP_ID,
      client_secret: env.THREADS_APP_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(origin),
      code,
    }),
  });
  // 2) curta duração -> longa duração (60 dias)
  const long = await call(`${GRAPH}/access_token?` + form({
    grant_type: 'th_exchange_token',
    client_secret: env.THREADS_APP_SECRET,
    access_token: short.access_token,
  }));
  const me = await call(`${API}/me?` + form({ fields: 'id,username', access_token: long.access_token }));
  const auth = {
    token: long.access_token,
    userId: me.id || String(short.user_id),
    username: me.username,
    expiresAt: Date.now() + (long.expires_in || 5184000) * 1000,
    refreshedAt: Date.now(),
    scopes: SCOPES,
  };
  await env.KV.put(KV_KEY, JSON.stringify(auth));
  return auth;
}

export async function getAuth(env) {
  const raw = await env.KV.get(KV_KEY);
  return raw ? JSON.parse(raw) : null;
}

/** O token foi obtido antes de o app pedir a permissão de respostas? */
export const canReply = (auth) => Boolean(auth?.scopes?.includes('threads_manage_replies'));

export async function disconnect(env) {
  await env.KV.delete(KV_KEY);
}

/** Renova o token de 60 dias. Só funciona com tokens com mais de 24h. */
export async function refreshToken(env) {
  const auth = await getAuth(env);
  if (!auth) return null;
  if (Date.now() - auth.refreshedAt < 24 * 3600 * 1000) return auth;
  const data = await call(`${GRAPH}/refresh_access_token?` + form({
    grant_type: 'th_refresh_token',
    access_token: auth.token,
  }));
  const next = {
    ...auth,
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 5184000) * 1000,
    refreshedAt: Date.now(),
  };
  await env.KV.put(KV_KEY, JSON.stringify(next));
  return next;
}

async function requireAuth(env) {
  const auth = await getAuth(env);
  if (!auth) throw new Error('Threads não conectado. Toque em "Conectar Threads".');
  if (auth.expiresAt < Date.now()) throw new Error('Token do Threads expirou. Conecte de novo.');
  return auth;
}

// ---------- Publicação ----------

function mediaFields(item) {
  if (item.kind === 'video') return { media_type: 'VIDEO', video_url: item.url, alt_text: item.alt };
  return { media_type: 'IMAGE', image_url: item.url, alt_text: item.alt };
}

/**
 * Passo 1. Cria os contêineres.
 * - sem mídia ou 1 mídia: um contêiner pronto para publicar;
 * - 2 a 10 mídias: um contêiner por item (o carrossel vem no passo 2).
 */
export async function createContainers(env, { text, media = [], replyToId }) {
  const auth = await requireAuth(env);
  const endpoint = `${API}/${auth.userId}/threads`;

  if (media.length <= 1) {
    const fields = media.length ? mediaFields(media[0]) : { media_type: 'TEXT' };
    const res = await call(endpoint, {
      method: 'POST',
      body: form({ ...fields, text, reply_to_id: replyToId, access_token: auth.token }),
    });
    return { containerId: res.id, itemIds: [] };
  }

  const itemIds = [];
  for (const item of media.slice(0, 10)) {
    const res = await call(endpoint, {
      method: 'POST',
      body: form({ ...mediaFields(item), is_carousel_item: 'true', access_token: auth.token }),
    });
    itemIds.push(res.id);
  }
  return { containerId: null, itemIds };
}

/** Passo 2 (só carrossel). Cria o contêiner do carrossel com os itens prontos. */
export async function createCarousel(env, { text, itemIds, replyToId }) {
  const auth = await requireAuth(env);
  const res = await call(`${API}/${auth.userId}/threads`, {
    method: 'POST',
    body: form({
      media_type: 'CAROUSEL',
      children: itemIds.join(','),
      text,
      reply_to_id: replyToId,
      access_token: auth.token,
    }),
  });
  return { containerId: res.id };
}

/** Situação de processamento: IN_PROGRESS, FINISHED, ERROR, EXPIRED ou PUBLISHED. */
export async function containerStatus(env, ids) {
  const auth = await requireAuth(env);
  const out = [];
  for (const id of ids.slice(0, 11)) {
    const res = await call(`${API}/${id}?` + form({ fields: 'status,error_message', access_token: auth.token }));
    out.push({ id, status: res.status, error: res.error_message || null });
  }
  return out;
}

/** Passo final. Publica e devolve o link do post. */
export async function publish(env, containerId) {
  const auth = await requireAuth(env);
  const res = await call(`${API}/${auth.userId}/threads_publish`, {
    method: 'POST',
    body: form({ creation_id: containerId, access_token: auth.token }),
  });
  let permalink = null;
  try {
    const info = await call(`${API}/${res.id}?` + form({ fields: 'permalink', access_token: auth.token }));
    permalink = info.permalink;
  } catch { /* o post saiu; só não conseguimos o link */ }
  return { id: res.id, url: permalink };
}
