// Nas Quadras Online — publica coberturas ao vivo no Threads e no Bluesky.

import { clearCookie, isLoggedIn, safeEqual, sessionCookie } from './auth.js';
import * as threads from './threads.js';
import * as bluesky from './bluesky.js';
import * as coverage from './coverage.js';
import * as lnb from './lnb.js';

const MAX_UPLOAD = 100 * 1024 * 1024; // limite de corpo de requisição dos Workers
const MEDIA_TTL_MS = 24 * 3600 * 1000;
const KEY_RE = /^[0-9]{13}-[0-9a-f-]{36}\.(jpg|png|webp|gif|mp4|mov|webm)$/;
const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
};

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});

const fail = (message, status = 400) => json({ error: message }, status);

async function body(request) {
  try { return await request.json(); } catch { return {}; }
}

/** Monta as URLs públicas da mídia a partir das chaves (nunca confia em URL vinda do navegador). */
function normalizeMedia(origin, media) {
  if (!Array.isArray(media)) return [];
  return media
    .filter((m) => m && KEY_RE.test(m.key))
    .map((m) => ({
      key: m.key,
      kind: m.kind === 'video' ? 'video' : 'image',
      mime: m.mime,
      width: Number(m.width) || undefined,
      height: Number(m.height) || undefined,
      alt: typeof m.alt === 'string' ? m.alt.slice(0, 1000) : '',
      url: `${origin}/m/${m.key}`,
    }));
}

async function serveMedia(request, env, key) {
  if (!KEY_RE.test(key)) return new Response('Not found', { status: 404 });
  const wantsRange = request.headers.has('Range');
  const obj = await env.MEDIA.get(key, wantsRange ? { range: request.headers } : undefined);
  if (!obj) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('ETag', obj.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=86400');
  if (wantsRange && obj.range && 'offset' in obj.range) {
    const start = obj.range.offset;
    const end = start + obj.range.length - 1;
    headers.set('Content-Range', `bytes ${start}-${end}/${obj.size}`);
    headers.set('Content-Length', String(obj.range.length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(obj.size));
  return new Response(request.method === 'HEAD' ? null : obj.body, { headers });
}

async function uploadMedia(request, env, origin) {
  const mime = (request.headers.get('Content-Type') || '').split(';')[0].trim();
  const ext = EXT[mime];
  if (!ext) return fail('Formato não suportado. Use JPG, PNG, WEBP, GIF, MP4, MOV ou WEBM.', 415);
  const size = Number(request.headers.get('Content-Length') || 0);
  if (!size) return fail('Arquivo vazio.');
  if (size > MAX_UPLOAD) return fail('Arquivo maior que 100 MB.', 413);

  const key = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
  await env.MEDIA.put(key, request.body, { httpMetadata: { contentType: mime } });
  return json({ key, url: `${origin}/m/${key}` });
}

async function history(env, entry) {
  const list = JSON.parse((await env.KV.get('history')) || '[]');
  if (!entry) return list;
  list.unshift({ ...entry, at: new Date().toISOString() });
  const trimmed = list.slice(0, 40);
  await env.KV.put('history', JSON.stringify(trimmed));
  return trimmed;
}

async function handleApi(request, env, url) {
  const { pathname } = url;
  const method = request.method;

  if (pathname === '/api/login' && method === 'POST') {
    if (!env.APP_PASSWORD || !env.SESSION_SECRET) {
      return fail('App sem senha configurada: cadastre APP_PASSWORD e SESSION_SECRET na Cloudflare.', 500);
    }
    const { password } = await body(request);
    if (!safeEqual(password || '', env.APP_PASSWORD)) {
      await new Promise((r) => setTimeout(r, 800)); // freia tentativas
      return fail('Senha incorreta.', 401);
    }
    return json({ ok: true }, 200, { 'Set-Cookie': await sessionCookie(env) });
  }

  if (pathname === '/api/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
  }

  if (!(await isLoggedIn(request, env))) return fail('Faça login.', 401);

  // Proteção simples contra requisições forjadas de outros sites.
  if (method !== 'GET' && request.headers.get('X-NQ') !== '1') return fail('Requisição inválida.', 403);

  const origin = url.origin;

  switch (`${method} ${pathname}`) {
    case 'GET /api/status': {
      const [t, b, cov] = await Promise.all([threads.getAuth(env), bluesky.status(env), coverage.get(env)]);
      return json({
        threads: t
          ? { connected: t.expiresAt > Date.now(), username: t.username, expiresAt: t.expiresAt, canReply: threads.canReply(t) }
          : { connected: false, configured: Boolean(env.THREADS_APP_SECRET) },
        bluesky: b,
        coverage: cov,
        redirectUri: threads.redirectUri(origin),
      });
    }

    case 'PUT /api/media':
      return uploadMedia(request, env, origin);

    case 'POST /api/threads/containers': {
      const { text = '', media, thread } = await body(request);
      const items = normalizeMedia(origin, media);
      if (!text.trim() && !items.length) return fail('Escreva um texto ou anexe uma mídia.');
      const replyToId = thread ? await coverage.threadsReplyTo(env) : null;
      return json(await threads.createContainers(env, { text, media: items, replyToId }));
    }

    case 'POST /api/threads/carousel': {
      const { text = '', itemIds = [], thread } = await body(request);
      const replyToId = thread ? await coverage.threadsReplyTo(env) : null;
      return json(await threads.createCarousel(env, { text, itemIds, replyToId }));
    }

    case 'POST /api/threads/status': {
      const { ids = [] } = await body(request);
      return json({ items: await threads.containerStatus(env, ids) });
    }

    case 'POST /api/threads/publish': {
      const { containerId, thread } = await body(request);
      if (!containerId) return fail('containerId ausente.');
      const published = await threads.publish(env, containerId);
      if (thread) await coverage.threadsAppend(env, published);
      return json(published);
    }

    case 'POST /api/threads/disconnect':
      await threads.disconnect(env);
      return json({ ok: true });

    case 'POST /api/bluesky/post': {
      const { text = '', media, thread } = await body(request);
      const items = normalizeMedia(origin, media);
      if (!text.trim() && !items.length) return fail('Escreva um texto ou anexe uma mídia.');
      const replyTo = thread ? await coverage.blueskyReplyTo(env) : null;
      const res = await bluesky.post(env, { text, media: items, replyTo });
      if (thread) await coverage.blueskyAppend(env, res);
      return json({ url: res.url, parts: res.parts, note: res.note });
    }

    case 'GET /api/coverage':
      return json(await coverage.get(env));

    case 'POST /api/coverage/start': {
      const { title = '' } = await body(request);
      return json(await coverage.start(env, title));
    }

    case 'POST /api/coverage/stop':
      return json(await coverage.stop(env));

    // ---------- Dados da LNB ----------
    case 'GET /api/lnb/today':
      return json({ games: await lnb.listToday() });

    case 'GET /api/lnb/game':
      return json(await lnb.getGame(url.searchParams.get('id')));

    case 'POST /api/lnb/resolve': {
      const { input = '' } = await body(request);
      return json({ id: await lnb.resolveMatchId(input) });
    }

    case 'GET /api/history':
      return json({ items: await history(env) });

    case 'POST /api/history': {
      const entry = await body(request);
      return json({
        items: await history(env, {
          text: String(entry.text || '').slice(0, 200),
          threads: entry.threads || null,
          bluesky: entry.bluesky || null,
        }),
      });
    }

    default:
      return fail('Rota não encontrada.', 404);
  }
}

async function handleAuth(request, env, url) {
  if (url.pathname === '/auth/threads/start') {
    if (!(await isLoggedIn(request, env))) return Response.redirect(`${url.origin}/`, 302);
    if (!env.THREADS_APP_SECRET) return new Response('Cadastre THREADS_APP_SECRET na Cloudflare.', { status: 500 });
    const state = crypto.randomUUID();
    await env.KV.put(`oauth:${state}`, '1', { expirationTtl: 600 });
    return Response.redirect(threads.authorizeUrl(env, url.origin, state), 302);
  }

  if (url.pathname === '/auth/threads/callback') {
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const back = (q) => Response.redirect(`${url.origin}/?${q}`, 302);
    if (url.searchParams.get('error')) return back('threads=cancelado');
    if (!state || !(await env.KV.get(`oauth:${state}`))) return back('threads=estado-invalido');
    await env.KV.delete(`oauth:${state}`);
    try {
      // A Meta às vezes anexa "#_" ao código.
      await threads.handleCallback(env, url.origin, (code || '').replace(/#_$/, ''));
      return back('threads=ok');
    } catch (err) {
      console.error('threads oauth callback:', err.message);
      return back(`threads=erro&msg=${encodeURIComponent(err.message.replace(/^Threads:\s*/, ''))}`);
    }
  }

  return new Response('Not found', { status: 404 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/m/') && (request.method === 'GET' || request.method === 'HEAD')) {
        return await serveMedia(request, env, url.pathname.slice(3));
      }
      if (url.pathname.startsWith('/auth/')) return await handleAuth(request, env, url);
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err);
      return fail(err.message || 'Erro inesperado.', 502);
    }
  },

  // Rotina diária: renova o token do Threads e apaga mídia com mais de 24h.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      try { await threads.refreshToken(env); } catch (err) { console.error('refresh threads', err); }

      let cursor;
      const cutoff = Date.now() - MEDIA_TTL_MS;
      do {
        const page = await env.MEDIA.list({ cursor, limit: 1000 });
        const old = page.objects.filter((o) => o.uploaded.getTime() < cutoff).map((o) => o.key);
        if (old.length) await env.MEDIA.delete(old);
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
    })());
  },
};
