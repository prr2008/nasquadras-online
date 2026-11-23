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

/** Troca a foto de capa da cobertura (precisa ser uma foto dos posts dela). */
export async function setCover(env, slug, key) {
  const { results } = await env.DB.prepare('SELECT media FROM posts WHERE game_slug = ?').bind(slug).all();
  const ok = results.some((r) => parseMedia(r.media).some((m) => m.kind === 'image' && m.key === key));
  if (!ok) return false;
  const r = await env.DB.prepare('UPDATE games SET cover_key = ?, updated_at = ? WHERE slug = ?').bind(key, Date.now(), slug).run();
  return r.meta.changes > 0;
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
  ['coluna', 'Coluna JB', '/coluna'],
  ['zona', 'Zona de Conforto', '/zona-de-conforto'],
  ['podcast', 'Podcast', '/podcast'],
  ['conversar', 'Vamos conversar', '/conversar'],
  ['sobre', 'Sobre', '/sobre'],
];

export const SOCIAL = [
  ['Threads', 'https://www.threads.net/@prr2008'],
  ['Bluesky', 'https://bsky.app/profile/prr2008.bsky.social'],
  ['X', 'https://x.com/prr2008'],
  ['Instagram', 'https://www.instagram.com/prr2008'],
  ['YouTube', 'https://www.youtube.com/@prr2008'],
  ['Substack', 'https://prr2008.substack.com'],
];

/** Newsletter no Substack: formulário oficial de inscrição (gratuita). */
export const SUBSTACK = 'https://prr2008.substack.com';

/** Agenda pública do Google (página de agendamento de horários). */
export const BOOKING = {
  link: 'https://calendar.app.google/TdyKm4WZK1gHsSiW9',
  embed: 'https://calendar.google.com/calendar/appointments/schedules/AcZssZ3xUAW8xvkdajIYT0H2p2leCWQUV2pYCg3U69Fq4XPNSMn1Lr54F7NOIgXhnCpTnmHA671K8bXF?gv=true',
};

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
  <div class="foot-links">${SOCIAL.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener me">${n}</a>`).join('')}<a href="/rss.xml">RSS</a><a href="/apoie">Apoie</a><a href="/privacidade">Privacidade</a><a href="/termos">Termos</a></div>
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

function mediaHtml(media, { admin = false, cover = null } = {}) {
  if (!media.length) return '';
  const items = media.map((m) => {
    const ratio = m.width && m.height ? ` style="aspect-ratio:${m.width}/${m.height}"` : '';
    if (m.kind === 'video') {
      return `<video controls playsinline preload="metadata" src="/m/${esc(m.key)}"${ratio} aria-label="${esc(m.alt || 'Vídeo')}"></video>`;
    }
    const img = `<a href="/m/${esc(m.key)}" target="_blank" rel="noopener"><img loading="lazy" src="/m/${esc(m.key)}" alt="${esc(m.alt)}"${ratio}></a>`;
    if (!admin) return img;
    // Só no app (logado): escolher esta foto como capa da cobertura.
    const on = m.key === cover;
    return `<div class="cover-pick">${img}<button type="button" class="set-cover${on ? ' on' : ''}" data-key="${esc(m.key)}">${on ? '★ Capa' : '☆ Usar como capa'}</button></div>`;
  }).join('');
  return `<div class="media n${Math.min(media.length, 4)}">${items}</div>`;
}

export function postHtml(p, { admin = false, cover = null } = {}) {
  return `<article class="post" id="p${p.id}" data-id="${p.id}">
    <header class="post-meta">
      <time datetime="${new Date(p.created_at).toISOString()}">${fmtTime(p.created_at)}</time>
      ${p.score ? `<span class="score">${esc(p.score)}</span>` : ''}
      ${admin ? `<button type="button" class="del" data-id="${p.id}" title="Apagar do site">Apagar</button>` : ''}
    </header>
    ${p.text ? `<div class="post-text">${renderText(p.text)}</div>` : ''}
    ${mediaHtml(p.media, { admin, cover })}
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

/** Ícones da barra "Compartilhar" (SVG em linha, na cor do texto). */
const SHARE_ICONS = {
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>',
  threads: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.586-1.308-.883-2.359-.89h-.029c-.844 0-1.992.232-2.721 1.32L7.734 7.847c.98-1.454 2.568-2.256 4.478-2.256h.044c3.194.02 5.097 1.975 5.287 5.388.108.046.216.094.321.142 1.49.7 2.58 1.761 3.154 3.07.797 1.82.871 4.79-1.548 7.158-1.85 1.81-4.094 2.628-7.277 2.65Zm1.003-11.69c-.242 0-.487.007-.739.021-1.836.103-2.98.946-2.916 2.143.067 1.256 1.452 1.839 2.784 1.767 1.224-.065 2.818-.543 3.086-3.71a10.5 10.5 0 0 0-2.215-.221z"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"/></svg>',
  email: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="m3 6 9 7 9-7"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/></svg>',
};

/**
 * Barra "Compartilhar": ícones de X, Threads, Facebook, e-mail e copiar link.
 * Os ícones de rede são links comuns (funcionam sem JavaScript); "Copiar link"
 * e "Mais opções" (compartilhamento do celular, com WhatsApp etc.) usam o /site.js.
 */
export function shareBar({ url, title, text = '' }) {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  const links = [
    ['x', 'Compartilhar no X', `https://x.com/intent/post?text=${encodeURIComponent(`${title} via @prr2008`)}&url=${u}`],
    ['threads', 'Compartilhar no Threads', `https://www.threads.net/intent/post?text=${encodeURIComponent(`${title} ${url}`)}`],
    ['facebook', 'Compartilhar no Facebook', `https://www.facebook.com/sharer/sharer.php?u=${u}`],
    ['email', 'Enviar por e-mail', `mailto:?subject=${t}&body=${encodeURIComponent(`${text ? `${text}\n\n` : ''}${url}`)}`],
  ];
  return `<div class="share" data-url="${esc(url)}" data-title="${esc(title)}">
    <span class="share-label">Compartilhar</span>
    ${links.map(([k, label, href]) => `<a class="share-btn share-${k}" href="${esc(href)}" aria-label="${label}" title="${label}"${k === 'email' ? '' : ' target="_blank" rel="noopener"'}>${SHARE_ICONS[k]}</a>`).join('')}
    <button type="button" class="share-btn share-copy" aria-label="Copiar link" title="Copiar link">${SHARE_ICONS.link}</button>
    <button type="button" class="share-btn share-more" aria-label="Mais opções de compartilhamento" title="Mais opções" hidden>${SHARE_ICONS.more}</button>
    <span class="share-status" role="status" aria-live="polite"></span>
  </div>`;
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
        ${shareBar({ url: `${origin}/c/${g.slug}`, title: g.title, text: desc })}
      </aside>
      <div class="game-main">
        <div id="new-posts" class="new-posts" hidden></div>
        <div id="posts" class="posts">${posts.map((p) => postHtml(p, { admin, cover: g.cover_key })).join('') || '<p class="empty">A cobertura vai começar.</p>'}</div>
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
