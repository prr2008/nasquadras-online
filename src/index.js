// Nas Quadras Online — publica coberturas ao vivo no Threads e no Bluesky.

import { clearCookie, isLoggedIn, safeEqual, sessionCookie } from './auth.js';
import * as threads from './threads.js';
import * as bluesky from './bluesky.js';
import * as coverage from './coverage.js';
import * as lnb from './lnb.js';
import * as site from './site.js';
import * as blog from './blog.js';
import * as pages from './pages.js';
import * as coluna from './coluna.js';
import * as zona from './zona.js';
import * as spotify from './spotify.js';
import * as wpimport from './wpimport.js';
import * as gdocs from './gdocs.js';
import * as schedule from './schedule.js';
import * as buffer from './buffer.js';
import * as indexnow from './indexnow.js';
import { supportInfo } from './pix.js';
import { applyMentions, compose, getMentions, saveMentions } from './compose.js';

const MAX_UPLOAD = 100 * 1024 * 1024; // limite de corpo de requisição dos Workers
const MEDIA_TTL_MS = 24 * 3600 * 1000;
const DAILY_CRON = '17 9 * * *'; // igual ao wrangler.jsonc
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

  // Google Docs: o script do documento entra com o código de conexão (sem cookie).
  if (pathname.startsWith('/api/gdocs/') && request.headers.has('Authorization')) {
    if (!(await gdocs.checkToken(env, request))) {
      await new Promise((r) => setTimeout(r, 800));
      return fail('Código de conexão inválido. Gere um novo no app (Blog → Google Docs).', 401);
    }
    const base = { site: canonical(env, url), app: url.origin };
    if (method === 'POST' && pathname === '/api/gdocs/info') return json(await gdocs.info(env, await body(request), base));
    if (method === 'POST' && pathname === '/api/gdocs/import') return json(await gdocs.importDoc(env, await body(request), base));
    return fail('Rota não encontrada.', 404);
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
      const { text = '', tags = '', media, thread } = await body(request);
      const items = normalizeMedia(origin, media);
      if (!text.trim() && !items.length) return fail('Escreva um texto ou anexe uma mídia.');
      const replyToId = thread ? await coverage.threadsReplyTo(env) : null;
      const c = compose({ network: 'threads', text, tags, mentions: await getMentions(env) });
      return json(await threads.createContainers(env, { text: c.text, topicTag: c.topic, media: items, replyToId }));
    }

    case 'POST /api/threads/carousel': {
      const { text = '', tags = '', itemIds = [], thread } = await body(request);
      const replyToId = thread ? await coverage.threadsReplyTo(env) : null;
      const c = compose({ network: 'threads', text, tags, mentions: await getMentions(env) });
      return json(await threads.createCarousel(env, { text: c.text, topicTag: c.topic, itemIds, replyToId }));
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
      const { text = '', tags = '', final = false, media, thread } = await body(request);
      const items = normalizeMedia(origin, media);
      if (!text.trim() && !items.length) return fail('Escreva um texto ou anexe uma mídia.');
      const replyTo = thread ? await coverage.blueskyReplyTo(env) : null;
      const c = compose({ network: 'bluesky', text, tags, inThread: Boolean(thread), threadFirst: !replyTo, final, mentions: await getMentions(env) });
      const res = await bluesky.post(env, { text: c.text, media: items, replyTo });
      if (thread) await coverage.blueskyAppend(env, res);
      return json({ url: res.url, parts: res.parts, note: res.note });
    }

    case 'GET /api/coverage':
      return json(await coverage.get(env));

    case 'POST /api/coverage/start': {
      const { title = '', lnbId = null } = await body(request);
      const cov = await coverage.start(env, title);
      // Cada cobertura ganha uma página no site.
      const slug = await site.ensureGame(env, { title: cov.title || 'Cobertura', startedAt: cov.startedAt, lnbId });
      await coverage.setSlug(env, slug);
      return json(await coverage.get(env));
    }

    case 'POST /api/coverage/stop': {
      const m = await coverage.meta(env);
      if (m?.slug) await site.setGameStatus(env, m.slug, 'ended');
      return json(await coverage.stop(env));
    }

    // ---------- Site ----------
    case 'POST /api/site/post': {
      const { text = '', media, game = null, lnbId = null } = await body(request);
      const items = normalizeMedia(origin, media);
      if (!text.trim() && !items.length) return fail('Escreva um texto ou anexe uma mídia.');
      const m = await coverage.meta(env);
      if (!m?.active) return fail('Inicie a cobertura do jogo para publicar no site.');
      let slug = m.slug;
      if (!slug) { // fio aberto antes de o site existir
        slug = await site.ensureGame(env, { title: m.title || 'Cobertura', startedAt: m.startedAt || Date.now(), lnbId });
        await coverage.setSlug(env, slug);
      }
      const c = compose({ network: 'site', text, mentions: await getMentions(env) });
      const res = await site.addPost(env, slug, { text: c.text, media: items, game, lnbId });
      return json({ ...res, url: `${origin}/c/${slug}` });
    }

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
          site: typeof entry.site === 'string' && entry.site.startsWith(origin) ? entry.site : null,
          x: entry.x ? true : null,
        }),
      });
    }

    // ---------- Blog (editor do app) ----------
    case 'GET /api/blog':
      return json({ articles: await blog.listAllArticles(env), categories: blog.CATEGORIES });

    case 'POST /api/blog':
      return json(await blog.createArticle(env, await body(request)));

    // Importação do WordPress, em lotes (o app chama até terminar).
    case 'POST /api/blog/import-wp':
      return json(await wpimport.importBatch(env, await body(request)));

    // ---------- Coluna (links das colunas no JB) ----------
    case 'GET /api/coluna':
      return json({ columns: await coluna.list(env) });

    case 'POST /api/coluna/preview': {
      const { url: link } = await body(request);
      return json(await coluna.fetchPreview(coluna.validUrl(link)));
    }

    case 'POST /api/coluna':
      return json(await coluna.add(env, await body(request)));

    // ---------- Zona de Conforto (edições com playlist) ----------
    case 'GET /api/zona':
      return json({ episodes: await zona.list(env) });

    case 'POST /api/zona/preview': {
      const { url: link } = await body(request);
      return json(await zona.fetchPreview(link));
    }

    case 'POST /api/zona':
      return json(await zona.add(env, await body(request)));

    // ---------- Spotify: nova edição a partir da lista ----------
    case 'GET /api/spotify/status':
      return json({ ...(await spotify.status(env)), redirectUri: spotify.redirectUri(origin) });

    case 'POST /api/spotify/disconnect':
      await spotify.disconnect(env);
      return json({ ok: true });

    case 'POST /api/spotify/match': {
      const { lines = [] } = await body(request);
      return json({ results: await spotify.matchLines(env, Array.isArray(lines) ? lines : String(lines).split('\n')) });
    }

    case 'POST /api/spotify/search': {
      const { q = '' } = await body(request);
      if (!String(q).trim()) return fail('Digite o que buscar.');
      const p = spotify.parseLine(q);
      const tracks = (await spotify.searchTracks(env, String(q).replace(/\s+[-–—]\s+/g, ' ')))
        .map((t) => ({ ...t, score: Math.round(spotify.score(t, p) * 100) / 100 }));
      return json({ tracks });
    }

    case 'POST /api/zona/create':
      return json(await zona.createFromList(env, spotify, await body(request), canonical(env, url)));

    case 'GET /api/spotify/zona-playlists': {
      const [lists, eps] = await Promise.all([spotify.zonaPlaylists(env), zona.list(env)]);
      const onSite = new Set(eps.map((e) => e.playlist_id));
      return json({ playlists: lists.map((p) => ({ ...p, onSite: onSite.has(p.id), ...zona.parseName(p.name) })) });
    }

    case 'POST /api/zona/import': {
      const { items = [] } = await body(request);
      return json({ results: await zona.importPlaylists(env, spotify, items) });
    }

    case 'GET /api/pages':
      return json({ pages: await blog.listPages(env) });

    // ---------- Agendamento ----------
    case 'GET /api/schedule':
      return json({ ...(await schedule.list(env)), buffer: buffer.configured(env) });

    case 'POST /api/buffer/post': {
      const { text = '', media } = await body(request);
      const items = normalizeMedia(origin.replace(/^http:\/\/(?!localhost|127\.)/, 'https://'), media);
      if (!text.trim() && !items.length) return fail('Escreva um texto ou anexe uma mídia.');
      const xText = applyMentions(text.trim(), 'x', await getMentions(env));
      return json({ id: await buffer.postNow(env, { text: xText, media: items }) });
    }

    // ---------- Menções por rede ----------
    case 'GET /api/mentions':
      return json({ mentions: await getMentions(env) });

    case 'PUT /api/mentions': {
      const { mentions = [] } = await body(request);
      return json({ mentions: await saveMentions(env, mentions) });
    }

    case 'GET /api/buffer/check':
      return json(await buffer.check(env));

    case 'POST /api/schedule':
      return json(await schedule.create(env, await body(request), origin));

    // ---------- Google Docs (código de conexão) ----------
    case 'GET /api/gdocs':
      return json(await gdocs.status(env));

    case 'POST /api/gdocs/token':
      // O código leva o endereço do app (sempre https fora do computador local) e o token.
      return json({ code: `${url.origin.replace(/^http:\/\/(?!localhost|127\.)/, 'https://')}#${await gdocs.newToken(env)}` });

    case 'DELETE /api/gdocs/token':
      await gdocs.revoke(env);
      return json({ ok: true });

    default: {
      const art = pathname.match(/^\/api\/blog\/(\d+)$/);
      if (art) {
        const id = Number(art[1]);
        if (method === 'GET') {
          const a = await blog.getArticleById(env, id);
          return a ? json(a) : fail('Artigo não encontrado.', 404);
        }
        if (method === 'PUT') {
          const a = await blog.updateArticle(env, id, await body(request));
          return a ? json(a) : fail('Artigo não encontrado.', 404);
        }
        if (method === 'DELETE') {
          return (await blog.deleteArticle(env, id)) ? json({ ok: true }) : fail('Artigo não encontrado.', 404);
        }
      }
      const col = pathname.match(/^\/api\/coluna\/(\d+)$/);
      if (col && method === 'PUT') {
        const c = await coluna.update(env, Number(col[1]), await body(request));
        return c ? json(c) : fail('Coluna não encontrada.', 404);
      }
      if (col && method === 'DELETE') {
        return (await coluna.remove(env, Number(col[1]))) ? json({ ok: true }) : fail('Coluna não encontrada.', 404);
      }

      const sch = pathname.match(/^\/api\/schedule\/(\d+)(\/now)?$/);
      if (sch) {
        const id = Number(sch[1]);
        if (sch[2] && method === 'POST') return json(await schedule.claimAndPublish(env, id, { now: true }));
        if (!sch[2] && method === 'PUT') {
          const r = await schedule.update(env, id, await body(request), origin);
          return r ? json(r) : fail('Agendamento não encontrado.', 404);
        }
        if (!sch[2] && method === 'DELETE') {
          const r = await schedule.cancel(env, id);
          return r ? json(r) : fail('Agendamento não encontrado.', 404);
        }
      }

      const ep = pathname.match(/^\/api\/zona\/(\d+)$/);
      if (ep && method === 'PUT') {
        const e = await zona.update(env, Number(ep[1]), await body(request));
        return e ? json(e) : fail('Edição não encontrada.', 404);
      }
      if (ep && method === 'DELETE') {
        return (await zona.remove(env, Number(ep[1]))) ? json({ ok: true }) : fail('Edição não encontrada.', 404);
      }

      const pg = pathname.match(/^\/api\/pages\/([a-z-]+)$/);
      if (pg && method === 'PUT') return json(await blog.savePage(env, pg[1], await body(request)));

      const del = pathname.match(/^\/api\/site\/post\/(\d+)$/);
      if (del && method === 'DELETE') {
        return (await site.deletePost(env, Number(del[1]))) ? json({ ok: true }) : fail('Post não encontrado.', 404);
      }
      return fail('Rota não encontrada.', 404);
    }
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

  if (url.pathname === '/auth/spotify/start') {
    if (!(await isLoggedIn(request, env))) return Response.redirect(`${url.origin}/`, 302);
    try {
      return Response.redirect(await spotify.authorizeUrl(env, url.origin), 302);
    } catch (err) {
      return new Response(err.message, { status: 500 });
    }
  }

  if (url.pathname === '/auth/spotify/callback') {
    const back = (q) => Response.redirect(`${url.origin}/app#zona?spotify=${q}`, 302);
    if (url.searchParams.get('error')) return back('cancelado');
    try {
      await spotify.handleCallback(env, url.origin, { code: url.searchParams.get('code'), state: url.searchParams.get('state') });
      return back('ok');
    } catch (err) {
      console.error('spotify oauth callback:', err.message);
      return back(`erro&msg=${encodeURIComponent(err.message.replace(/^Spotify:\s*/, ''))}`);
    }
  }

  return new Response('Not found', { status: 404 });
}

const html = (body, status = 200, extra = {}) => new Response(body, {
  status,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...extra },
});

/** Placar ao vivo: se a página está ligada a um jogo da LNB, usa o dado mais recente. */
async function withLiveScore(g) {
  if (!g.lnb_id || g.status !== 'live' || g.period === 'FINAL') return g;
  try {
    const live = await lnb.getGame(g.lnb_id);
    const period = live.status === 'final' ? 'FINAL' : live.period > 4 ? 'OT' : `${Math.max(1, live.period)}Q`;
    return { ...g, home: live.home.name, away: live.away.name, home_score: live.home.score, away_score: live.away.score, period };
  } catch {
    return g;
  }
}

// ---------- Site principal (nasquadras.online) ----------

const SITE_HOSTS = new Set(['nasquadras.online']);
const isSiteHost = (url) => SITE_HOSTS.has(url.hostname);
/** No domínio principal o início é "/"; nos outros endereços "/" é o app e o site fica em "/inicio". */
const homeOf = (url) => (isSiteHost(url) ? '/' : '/inicio');
/** Endereço oficial usado em links de compartilhamento, RSS e sitemap. */
const canonical = (env, url) => (env.SITE_URL || url.origin).replace(/\/$/, '');

async function handleSite(request, env, url) {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const parts = url.pathname.split('/').filter(Boolean); // ['c', slug, 'fotos']
  const origin = canonical(env, url);
  const home = homeOf(url);

  if (parts.length === 1) return html(site.indexPage(await site.listGames(env), origin, { home }));

  const slug = decodeURIComponent(parts[1] || '');
  const game = await site.getGame(env, slug);
  if (!game || parts.length > 3 || (parts[2] && parts[2] !== 'fotos')) return html(site.notFoundPage({ home }), 404);

  const [g, posts] = await Promise.all([withLiveScore(game), site.getPosts(env, slug)]);
  if (parts[2] === 'fotos') return html(site.galleryPage(g, posts, origin, { home }));
  const admin = await isLoggedIn(request, env);
  return html(site.gamePage(g, posts, origin, { admin, home }));
}

const xmlRes = (body, type) => new Response(body, { headers: { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'public, max-age=600' } });

/** Páginas do site principal. Devolve null quando o caminho não é do site. */
async function handleMainSite(request, env, url) {
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const origin = canonical(env, url);
  const home = homeOf(url);

  if ((p === '/' && isSiteHost(url)) || p === '/inicio') {
    if (p === '/inicio' && isSiteHost(url)) return Response.redirect(`${url.origin}/`, 301);
    const [games, articles, cols, eps] = await Promise.all([site.listGames(env, 8), blog.listPublished(env, { limit: 6 }), coluna.list(env, 4), zona.list(env, 1)]);
    const live = games.find((g) => g.status === 'live' && g.period !== 'FINAL');
    const withLive = live ? await withLiveScore(live) : null;
    return html(pages.homePage({ games: games.map((g) => (g === live ? withLive : g)), articles, origin, home, columns: cols, latestEpisode: eps[0] || null, support: supportInfo(env) }));
  }

  if (p === '/blog') return html(pages.blogIndexPage({ articles: await blog.listPublished(env), origin, home }));

  const cat = p.match(/^\/blog\/categoria\/([a-z0-9-]+)$/);
  if (cat) {
    const category = blog.CATEGORIES.find((c) => blog.categorySlug(c) === cat[1]);
    if (!category) return html(site.notFoundPage({ home }), 404);
    return html(pages.blogIndexPage({ articles: await blog.listPublished(env, { category }), origin, category, home }));
  }

  const art = p.match(/^\/blog\/([a-z0-9-]+)$/);
  if (art) {
    const admin = await isLoggedIn(request, env);
    const a = await blog.getArticleBySlug(env, art[1], { includeDrafts: admin });
    if (!a) return html(site.notFoundPage({ home }), 404);
    const related = (await blog.listPublished(env, { category: a.category, limit: 4 })).filter((x) => x.id !== a.id).slice(0, 3);
    return html(pages.articlePage({ a, origin, admin, related, home, support: supportInfo(env) }));
  }

  if (p === '/coluna') {
    const [columns, page, admin] = await Promise.all([coluna.list(env), blog.getPage(env, 'coluna'), isLoggedIn(request, env)]);
    return html(pages.columnPage({ columns, page, origin, admin, home }));
  }

  if (p === '/zona-de-conforto') {
    const [episodes, page, admin] = await Promise.all([zona.list(env), blog.getPage(env, 'zona-de-conforto'), isLoggedIn(request, env)]);
    return html(pages.zonaPage({ page, episodes, origin, admin, home }));
  }

  if (p === '/conversar') return html(pages.talkPage({ origin, home }));
  if (p === '/apoie') return html(pages.supportPage({ support: supportInfo(env), origin, home }));

  const fixed = p.match(/^\/(sobre)$/);
  if (fixed) {
    const [page, admin] = await Promise.all([blog.getPage(env, fixed[1]), isLoggedIn(request, env)]);
    return html(pages.staticPage({ page, slug: fixed[1], origin, admin, home, support: supportInfo(env) }));
  }

  if (p === '/rss.xml') {
    return xmlRes(pages.rssFeed({ articles: await blog.listPublished(env, { limit: 30, withBody: true }), origin }), 'application/rss+xml');
  }
  if (p === '/sitemap.xml') {
    const [articles, games] = await Promise.all([blog.listPublished(env, { limit: 1000 }), site.listGames(env, 1000)]);
    return xmlRes(pages.sitemap({ articles, games, origin }), 'application/xml');
  }
  const key = indexnow.keyFile(env, p);
  if (key) return new Response(key, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  if (p === '/robots.txt') {
    return xmlRes(`User-agent: *\nDisallow: /api/\nDisallow: /app\nSitemap: ${origin}/sitemap.xml\n`, 'text/plain');
  }
  return null;
}

/** Atualizações da página ao vivo: posts novos (já em HTML) e o placar. */
async function handlePublicApi(request, env, url) {
  const m = url.pathname.match(/^\/api\/public\/c\/([^/]+)$/);
  if (!m || request.method !== 'GET') return fail('Rota não encontrada.', 404);
  const game = await site.getGame(env, decodeURIComponent(m[1]));
  if (!game) return fail('Cobertura não encontrada.', 404);
  const since = Number(url.searchParams.get('since')) || 0;
  const [g, posts, admin] = await Promise.all([withLiveScore(game), site.getPosts(env, game.slug, since), isLoggedIn(request, env)]);
  return json({
    board: site.boardHtml(g),
    live: g.status === 'live' && g.period !== 'FINAL',
    posts: posts.map((p) => ({ id: p.id, html: site.postHtml(p, { admin }) })),
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/m/') && (request.method === 'GET' || request.method === 'HEAD')) {
        return await serveMedia(request, env, url.pathname.slice(3));
      }
      if (url.pathname.startsWith('/auth/')) return await handleAuth(request, env, url);
      if (url.hostname === 'www.nasquadras.online') {
        return Response.redirect(`https://nasquadras.online${url.pathname}${url.search}`, 301);
      }
      if (url.pathname === '/c' || url.pathname.startsWith('/c/')) return await handleSite(request, env, url);
      // No domínio do site, o app fica no endereço próprio dele.
      if (isSiteHost(url) && url.pathname === '/app') return Response.redirect('https://app.nasquadras.online/', 302);
      if (url.pathname === '/app') return env.ASSETS.fetch(new Request(new URL('/', url), request));
      if (request.method === 'GET' && !url.pathname.startsWith('/api/')) {
        const page = await handleMainSite(request, env, url);
        if (page) return page;
      }
      if (url.pathname.startsWith('/api/public/')) return await handlePublicApi(request, env, url);
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env, url);
      const asset = await env.ASSETS.fetch(request);
      // Markdown (Novidades) em UTF-8, para os acentos aparecerem certos.
      if (url.pathname.endsWith('.md') && asset.ok) {
        const res = new Response(asset.body, asset);
        res.headers.set('Content-Type', 'text/markdown; charset=utf-8');
        return res;
      }
      return asset;
    } catch (err) {
      console.error(err);
      return fail(err.message || 'Erro inesperado.', 502);
    }
  },

  // Rotina diária: renova o token do Threads e apaga mídia com mais de 24h.
  async scheduled(event, env, ctx) {
    // A cada minuto: publica os posts agendados que venceram.
    ctx.waitUntil(schedule.runDue(env).catch((err) => console.error('agendados', err)));
    // A cada 10 minutos: avisa os buscadores (IndexNow) do que mudou no site.
    if (new Date(event.scheduledTime).getUTCMinutes() % 10 === 3) {
      const origin = (env.SITE_URL || 'https://nasquadras.online').replace(/\/$/, '');
      ctx.waitUntil(indexnow.run(env, origin).then((r) => r.sent && console.log('indexnow enviado', r.sent, r.status)).catch((err) => console.error('indexnow', err.message)));
    }
    if (event.cron !== DAILY_CRON) return;

    ctx.waitUntil((async () => {
      try { await threads.refreshToken(env); } catch (err) { console.error('refresh threads', err); }

      // Mídia publicada no site fica guardada; o resto sai depois de 24h.
      let keep;
      try {
        const [a, b, c, d] = await Promise.all([site.referencedKeys(env), blog.referencedKeys(env), coluna.referencedKeys(env), schedule.referencedKeys(env)]);
        keep = new Set([...a, ...b, ...c, ...d]);
      } catch (err) { console.error('site keys', err); return; }
      let cursor;
      const cutoff = Date.now() - MEDIA_TTL_MS;
      do {
        const page = await env.MEDIA.list({ cursor, limit: 1000 });
        const old = page.objects.filter((o) => o.uploaded.getTime() < cutoff && !keep.has(o.key)).map((o) => o.key);
        if (old.length) await env.MEDIA.delete(old);
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
    })());
  },
};
