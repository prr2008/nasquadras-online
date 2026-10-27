// Integração com o Bluesky (AT Protocol), usando handle + senha de app.

import { BLUESKY_MAX, buildFacets, splitIntoThread } from './text.js';

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

const webUrl = (handle, uri) => `https://bsky.app/profile/${handle}/post/${uri.split('/').pop()}`;

/** Publica no Bluesky. Texto acima de 300 caracteres vira um fio numerado. */
export async function post(env, { text, media = [], langs = ['pt'] }) {
  return withSession(env, async (session) => {
    const parts = splitIntoThread(text || '', BLUESKY_MAX);
    const { embed, note } = await buildEmbed(env, session, media);

    let root = null;
    let parent = null;
    let firstUri = null;

    for (let i = 0; i < parts.length; i++) {
      const record = {
        $type: 'app.bsky.feed.post',
        text: parts[i],
        createdAt: new Date().toISOString(),
        langs,
      };
      const facets = buildFacets(parts[i]);
      if (facets.length) record.facets = facets;
      if (i === 0 && embed) record.embed = embed;
      if (parent) record.reply = { root, parent };

      const res = await xrpc(session.pds, 'com.atproto.repo.createRecord', {
        token: session.accessJwt,
        json: { repo: session.did, collection: 'app.bsky.feed.post', record },
      });
      const ref = { uri: res.uri, cid: res.cid };
      if (!root) { root = ref; firstUri = res.uri; }
      parent = ref;
    }

    return { url: webUrl(session.handle, firstUri), parts: parts.length, note };
  });
}
