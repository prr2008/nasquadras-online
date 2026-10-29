// Site público das coberturas: dados (D1) e páginas HTML geradas no servidor.
//   /c                 -> todas as coberturas
//   /c/<slug>          -> uma cobertura (posts ao vivo, mais recentes primeiro)
//   /c/<slug>/fotos    -> galeria de fotos da cobertura

const TZ = 'America/Sao_Paulo';
export const PERIOD_LABEL = {
  '1Q': '1º quarto', '2Q': '2º quarto', INT: 'Intervalo', '3Q': '3º quarto',
  '4Q': '4º quarto', OT: 'Prorrogação', FINAL: 'Final',
};

// ---------- Utilitários ----------

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function slugify(title, startedAt) {
  const base = String(title || 'cobertura')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'cobertura';
  const d = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date(startedAt)).replace(/\//g, '-');
  return `${base}-${d}`;
}

export const fmtDate = (ms) => new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
}).format(new Date(ms));

export const fmtTime = (ms) => new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit',
}).format(new Date(ms));

const fmtShortDate = (ms) => new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric',
}).format(new Date(ms));

/** Texto do post em HTML seguro: links clicáveis, hashtags destacadas, quebras de linha. */
export function renderText(text) {
  const parts = String(text || '').split(/(https?:\/\/[^\s<>"']+)/g);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      const url = part.replace(/[.,;:!?)\]]+$/, '');
      const tail = part.slice(url.length);
      const shown = url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48) + (url.length > 56 ? '…' : '');
      return `<a href="${esc(url)}" target="_blank" rel="noopener nofollow">${esc(shown)}</a>${esc(tail)}`;
    }
    return esc(part).replace(/(^|\s)(#[\p{L}\p{N}_]*\p{L}[\p{L}\p{N}_]*)/gu, '$1<span class="tag">$2</span>');
  }).join('').replace(/\n/g, '<br>');
}

const parseMedia = (m) => { try { return JSON.parse(m || '[]'); } catch { return []; } };

// ---------- Dados ----------

/** Cobertura aberta com o título padrão ("Cobertura"): usa o nome dos times. */
export function withTitle(g) {
  if (g && g.home && g.away && /^\s*cobertura\s*$/i.test(g.title || '')) return { ...g, title: `${g.home} x ${g.away}` };
  return g;
}

export async function getGame(env, slug) {
  return withTitle(await env.DB.prepare('SELECT * FROM games WHERE slug = ?').bind(slug).first());
}

/** Cria (ou reaproveita) a página de uma cobertura. */
export async function ensureGame(env, { title, startedAt, lnbId = null }) {
  const slug = slugify(title, startedAt);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO games (slug, title, lnb_id, status, started_at, updated_at)
     VALUES (?, ?, ?, 'live', ?, ?) ON CONFLICT(slug) DO NOTHING`,
  ).bind(slug, title || 'Cobertura', lnbId, startedAt, now).run();
  return slug;
}

export async function setGameStatus(env, slug, status) {
  await env.DB.prepare('UPDATE games SET status = ?, updated_at = ? WHERE slug = ?').bind(status, Date.now(), slug).run();
}

/** Grava um post e atualiza o placar/capa da página. */
export async function addPost(env, slug, { text = '', media = [], game = null, lnbId = null }) {
  const now = Date.now();
  const clean = media.map(({ key, kind, width, height, alt }) => ({ key, kind, width, height, alt: alt || '' }));
  const label = game?.period ? PERIOD_LABEL[game.period] || '' : '';
  const score = game && (game.sa || game.sh) ? `${game.sa} x ${game.sh}${label ? ` · ${label}` : ''}` : null;
  const cover = clean.find((m) => m.kind === 'image')?.key || null;

  const res = await env.DB.prepare(
    'INSERT INTO posts (game_slug, text, media, score, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(slug, text, JSON.stringify(clean), score, now).run();

  await env.DB.prepare(
    `UPDATE games SET
       home = COALESCE(?, home), away = COALESCE(?, away),
       home_score = COALESCE(?, home_score), away_score = COALESCE(?, away_score),
       period = COALESCE(?, period), lnb_id = COALESCE(lnb_id, ?),
       cover_key = COALESCE(cover_key, ?), updated_at = ?
     WHERE slug = ?`,
  ).bind(
    game?.away || null, game?.home || null, // no app, à esquerda fica o mandante
    game ? Number(game.sa) || 0 : null, game ? Number(game.sh) || 0 : null,
    game?.period || null, lnbId, cover, now, slug,
  ).run();

  return { id: res.meta.last_row_id, slug };
}

export async function deletePost(env, id) {
  const r = await env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
  return r.meta.changes > 0;
}

export async function listGames(env, limit = 60) {
  const { results } = await env.DB.prepare(
    `SELECT g.*, (SELECT COUNT(*) FROM posts p WHERE p.game_slug = g.slug) AS n_posts
     FROM games g ORDER BY g.started_at DESC LIMIT ?`,
  ).bind(limit).all();
  return results.map(withTitle);
}

export async function getPosts(env, slug, sinceId = 0) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM posts WHERE game_slug = ? AND id > ? ORDER BY id DESC LIMIT 500',
  ).bind(slug, sinceId).all();
  return results.map((p) => ({ ...p, media: parseMedia(p.media) }));
}

/** Chaves de mídia usadas no site (não podem ser apagadas pela limpeza diária). */
export async function referencedKeys(env) {
  const { results } = await env.DB.prepare("SELECT media FROM posts WHERE media != '[]'").all();
  const keys = new Set();
  for (const r of results) for (const m of parseMedia(r.media)) keys.add(m.key);
  return keys;
}

// ---------- HTML ----------

export const NAV = [
  ['inicio', 'Início', '/'],
  ['coberturas', 'Coberturas', '/c'],
  ['blog', 'Blog', '/blog'],
  ['coluna', 'Coluna', '/coluna'],
  ['zona', 'Zona de Conforto', '/zona-de-conforto'],
  ['sobre', 'Sobre', '/sobre'],
];

export const SOCIAL = [
  ['Threads', 'https://www.threads.net/@prr2008'],
  ['Bluesky', 'https://bsky.app/profile/prr2008.bsky.social'],
  ['X', 'https://x.com/prr2008'],
  ['YouTube', 'https://www.youtube.com/@prr2008'],
];

export function layout({ title, description = '', image = '', url = '', body, live = false, nav = 'coberturas', type = 'article', head = '', home = '/' }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f1115">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="${esc(type)}">
<meta property="og:site_name" content="Nas Quadras">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${url ? `<meta property="og:url" content="${esc(url)}">` : ''}
${url ? `<link rel="canonical" href="${esc(url)}">` : ''}
${image ? `<meta property="og:image" content="${esc(image)}"><meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
<link rel="alternate" type="application/rss+xml" title="Nas Quadras — Blog" href="/rss.xml">
${head}
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='28' fill='%23ff7a1a'/%3E%3Cpath d='M4 32h56M32 4v56M12 12c10 10 10 30 0 40M52 12c-10 10-10 30 0 40' stroke='%230f1115' stroke-width='3' fill='none'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/site.css">
</head>
<body${live ? ' data-live="1"' : ''}>
<header class="site-head">
  <div class="head-row">
    <a class="brand" href="${home}"><span class="ball" aria-hidden="true"></span>Nas Quadras</a>
    <nav class="menu" aria-label="Menu principal">
      ${NAV.map(([key, label, href]) => `<a href="${key === 'inicio' ? home : href}"${key === nav ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
    </nav>
  </div>
</header>
<main class="wrap">
${body}
</main>
<footer class="site-foot">
  <div><strong>Nas Quadras</strong> · basquete por Pedro Rodrigues</div>
  <div class="foot-links">${SOCIAL.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener me">${n}</a>`).join('')}<a href="/rss.xml">RSS</a></div>
</footer>
<script src="/site.js" defer></script>
<!-- Cloudflare Web Analytics (sem cookies): só nas páginas públicas, o app não é medido. -->
<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "0f4c4364473b4a2a80d252b640cf5dbc"}'></script>
</body>
</html>`;
}

function scoreboard(g) {
  const label = g.status === 'ended' && g.period !== 'FINAL' ? 'Encerrada' : PERIOD_LABEL[g.period] || '';
  const live = g.status === 'live' && g.period !== 'FINAL';
  if (!g.home && !g.away) {
    return `<div class="board" id="board"><div class="board-title">${esc(g.title)}</div>${live ? '<span class="live-pill">Ao vivo</span>' : ''}</div>`;
  }
  return `<div class="board" id="board">
    <div class="team"><span class="name">${esc(g.home)}</span><span class="pts">${g.home_score ?? 0}</span></div>
    <div class="mid">${live ? '<span class="live-pill">Ao vivo</span>' : ''}<span class="period">${esc(label)}</span></div>
    <div class="team"><span class="name">${esc(g.away)}</span><span class="pts">${g.away_score ?? 0}</span></div>
  </div>`;
}

function mediaHtml(media) {
  if (!media.length) return '';
  const items = media.map((m) => {
    const ratio = m.width && m.height ? ` style="aspect-ratio:${m.width}/${m.height}"` : '';
    if (m.kind === 'video') {
      return `<video controls playsinline preload="metadata" src="/m/${esc(m.key)}"${ratio} aria-label="${esc(m.alt || 'Vídeo')}"></video>`;
    }
    return `<a href="/m/${esc(m.key)}" target="_blank" rel="noopener"><img loading="lazy" src="/m/${esc(m.key)}" alt="${esc(m.alt)}"${ratio}></a>`;
  }).join('');
  return `<div class="media n${Math.min(media.length, 4)}">${items}</div>`;
}

export function postHtml(p, { admin = false } = {}) {
  return `<article class="post" id="p${p.id}" data-id="${p.id}">
    <header class="post-meta">
      <time datetime="${new Date(p.created_at).toISOString()}">${fmtTime(p.created_at)}</time>
      ${p.score ? `<span class="score">${esc(p.score)}</span>` : ''}
      ${admin ? `<button type="button" class="del" data-id="${p.id}" title="Apagar do site">Apagar</button>` : ''}
    </header>
    ${p.text ? `<div class="post-text">${renderText(p.text)}</div>` : ''}
    ${mediaHtml(p.media)}
  </article>`;
}

export function boardHtml(g) {
  return scoreboard(g);
}

export function indexPage(games, origin, { home = '/' } = {}) {
  const cards = games.map((g) => {
    const score = g.home ? `${esc(g.home)} <b>${g.home_score ?? 0}</b> x <b>${g.away_score ?? 0}</b> ${esc(g.away)}` : esc(g.title);
    const live = g.status === 'live' && g.period !== 'FINAL';
    return `<a class="card" href="/c/${esc(g.slug)}">
      ${g.cover_key ? `<img loading="lazy" src="/m/${esc(g.cover_key)}" alt="">` : '<div class="card-ph" aria-hidden="true"></div>'}
      <div class="card-body">
        <span class="card-date">${fmtShortDate(g.started_at)}${live ? ' · <span class="live-dot">ao vivo</span>' : ''}</span>
        <strong>${esc(g.title)}</strong>
        <span class="card-score">${score}</span>
        <span class="card-n">${g.n_posts} ${g.n_posts === 1 ? 'post' : 'posts'}</span>
      </div>
    </a>`;
  }).join('');
  return layout({
    title: 'Coberturas ao vivo · Nas Quadras',
    description: 'Coberturas ao vivo de basquete por Pedro Rodrigues.',
    url: `${origin}/c`,
    type: 'website',
    home,
    body: `<h1 class="page-title">Coberturas</h1>
      ${games.length ? `<div class="cards">${cards}</div>` : '<p class="empty">Nenhuma cobertura publicada ainda.</p>'}`,
  });
}

export function gamePage(g, posts, origin, { admin = false, home = '/' } = {}) {
  const live = g.status === 'live' && g.period !== 'FINAL';
  const photos = posts.reduce((n, p) => n + p.media.length, 0);
  const desc = g.home
    ? `${g.home} ${g.home_score ?? 0} x ${g.away_score ?? 0} ${g.away} · ${live ? 'ao vivo' : PERIOD_LABEL[g.period] || 'cobertura'} · ${fmtShortDate(g.started_at)}`
    : `Cobertura ao vivo · ${fmtShortDate(g.started_at)}`;
  return layout({
    title: `${g.title} · Nas Quadras`,
    description: desc,
    image: g.cover_key ? `${origin}/m/${g.cover_key}` : '',
    url: `${origin}/c/${g.slug}`,
    live,
    home,
    body: `<div class="game" data-slug="${esc(g.slug)}" data-last="${posts[0]?.id || 0}" data-admin="${admin ? 1 : 0}">
      <header class="game-head">
        <p class="crumbs"><a href="/c">Coberturas</a> · ${esc(fmtDate(g.started_at))}</p>
        <h1 class="page-title">${esc(g.title)}</h1>
      </header>
      <aside class="game-side">
        ${scoreboard(g)}
        <nav class="tabs"><a class="on" href="/c/${esc(g.slug)}">Posts (${posts.length})</a>${photos ? `<a href="/c/${esc(g.slug)}/fotos">Fotos (${photos})</a>` : ''}</nav>
      </aside>
      <div class="game-main">
        <div id="new-posts" class="new-posts" hidden></div>
        <div id="posts" class="posts">${posts.map((p) => postHtml(p, { admin })).join('') || '<p class="empty">A cobertura vai começar.</p>'}</div>
      </div>
    </div>`,
  });
}

export function galleryPage(g, posts, origin, { home = '/' } = {}) {
  const items = posts.flatMap((p) => p.media.map((m) => ({ ...m, at: p.created_at })));
  const grid = items.map((m) => (m.kind === 'video'
    ? `<figure><video controls playsinline preload="metadata" src="/m/${esc(m.key)}"></video><figcaption>${fmtTime(m.at)}${m.alt ? ` · ${esc(m.alt)}` : ''}</figcaption></figure>`
    : `<figure><a href="/m/${esc(m.key)}" target="_blank" rel="noopener"><img loading="lazy" src="/m/${esc(m.key)}" alt="${esc(m.alt)}"></a><figcaption>${fmtTime(m.at)}${m.alt ? ` · ${esc(m.alt)}` : ''}</figcaption></figure>`)).join('');
  return layout({
    title: `Fotos · ${g.title} · Nas Quadras`,
    description: `Fotos da cobertura ${g.title} (${fmtShortDate(g.started_at)}).`,
    image: g.cover_key ? `${origin}/m/${g.cover_key}` : '',
    url: `${origin}/c/${g.slug}/fotos`,
    home,
    body: `<p class="crumbs"><a href="/c">Coberturas</a> · <a href="/c/${esc(g.slug)}">${esc(g.title)}</a></p>
      <h1 class="page-title">Fotos</h1>
      <nav class="tabs"><a href="/c/${esc(g.slug)}">Posts</a><a class="on" href="/c/${esc(g.slug)}/fotos">Fotos (${items.length})</a></nav>
      ${items.length ? `<div class="gallery">${grid}</div>` : '<p class="empty">Ainda não há fotos nesta cobertura.</p>'}`,
  });
}

export function notFoundPage({ home = '/' } = {}) {
  return layout({
    title: 'Página não encontrada · Nas Quadras',
    nav: '',
    home,
    body: `<h1 class="page-title">Página não encontrada</h1><p class="empty"><a href="${home}">Voltar ao início</a></p>`,
  });
}
