// Páginas do site principal: Início, Blog, artigo, categoria, páginas fixas, RSS e sitemap.

import { layout, esc, fmtDate, PERIOD_LABEL } from './site.js';
import { CATEGORIES, PAGES, categorySlug, excerpt, readingMinutes } from './blog.js';

const TZ = 'America/Sao_Paulo';
const shortDate = (ms) => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ms)).replace('.', '');
const coverUrl = (origin, key) => (key ? `${origin}/m/${key}` : '');

function articleCard(a) {
  return `<a class="card article-card" href="/blog/${esc(a.slug)}">
    ${a.cover_key ? `<img loading="lazy" src="/m/${esc(a.cover_key)}" alt="">` : '<div class="card-ph" aria-hidden="true"></div>'}
    <div class="card-body">
      <span class="card-date"><span class="cat">${esc(a.category)}</span> · ${shortDate(a.published_at)}</span>
      <strong>${esc(a.title)}</strong>
      <span class="card-excerpt">${esc(excerpt(a, 140))}</span>
    </div>
  </a>`;
}

function coverageCard(g) {
  const live = g.status === 'live' && g.period !== 'FINAL';
  const score = g.home ? `${esc(g.home)} <b>${g.home_score ?? 0}</b> x <b>${g.away_score ?? 0}</b> ${esc(g.away)}` : esc(g.title);
  return `<a class="card" href="/c/${esc(g.slug)}">
    ${g.cover_key ? `<img loading="lazy" src="/m/${esc(g.cover_key)}" alt="">` : '<div class="card-ph" aria-hidden="true"></div>'}
    <div class="card-body">
      <span class="card-date">${shortDate(g.started_at)}${live ? ' · <span class="live-dot">ao vivo</span>' : ''}</span>
      <strong>${esc(g.title)}</strong>
      <span class="card-score">${score}</span>
    </div>
  </a>`;
}

const categoryNav = (active = '') => `<nav class="tabs cats" aria-label="Categorias">
  <a href="/blog"${active ? '' : ' class="on"'}>Todos</a>
  ${CATEGORIES.map((c) => `<a href="/blog/categoria/${categorySlug(c)}"${c === active ? ' class="on"' : ''}>${esc(c)}</a>`).join('')}
</nav>`;

// ---------- Início ----------

export function homePage({ games, articles, origin, home = '/', latestColumn = null }) {
  const live = games.find((g) => g.status === 'live' && g.period !== 'FINAL');
  const liveBlock = live ? `<section class="live-hero">
      <a href="/c/${esc(live.slug)}" class="live-hero-link">
        <span class="live-pill">Ao vivo agora</span>
        <strong>${esc(live.title)}</strong>
        ${live.home ? `<span class="hero-score">${esc(live.home)} <b>${live.home_score ?? 0}</b> x <b>${live.away_score ?? 0}</b> ${esc(live.away)} · ${esc(PERIOD_LABEL[live.period] || '')}</span>` : ''}
        <span class="hero-cta">Acompanhar a cobertura →</span>
      </a>
    </section>` : '';

  const recentGames = games.filter((g) => g !== live).slice(0, 3);
  return layout({
    title: 'Nas Quadras · Basquete por Pedro Rodrigues',
    description: 'Coberturas ao vivo, análises e a coluna Nas Quadras: basquete brasileiro e NBA por Pedro Rodrigues.',
    url: `${origin}/`,
    type: 'website',
    nav: 'inicio',
    home,
    body: `<section class="intro">
        <h1 class="page-title">Nas Quadras</h1>
        <p class="lede">Basquete brasileiro e NBA por <strong>Pedro Rodrigues</strong>: coberturas ao vivo, análises e a coluna no Jornal do Brasil.</p>
      </section>
      ${liveBlock}
      <section class="home-block">
        <header class="block-head"><h2>Do blog</h2><a href="/blog">Ver todos →</a></header>
        ${articles.length ? `<div class="cards">${articles.slice(0, 3).map(articleCard).join('')}</div>` : '<p class="empty">Os primeiros textos estão a caminho.</p>'}
      </section>
      <section class="home-block">
        <header class="block-head"><h2>Coberturas</h2><a href="/c">Ver todas →</a></header>
        ${recentGames.length ? `<div class="cards">${recentGames.map(coverageCard).join('')}</div>` : '<p class="empty">Nenhuma cobertura anterior.</p>'}
      </section>
      <section class="home-block promo">
        <a class="promo-card" href="/coluna"><strong>Coluna Nas Quadras</strong><span>${latestColumn ? `Mais recente: ${esc(latestColumn.title)}` : 'No Jornal do Brasil'}</span></a>
        <a class="promo-card" href="/zona-de-conforto"><strong>Zona de Conforto</strong><span>Música, cultura e esporte</span></a>
      </section>`,
  });
}

// ---------- Blog ----------

export function blogIndexPage({ articles, origin, category = '', home = '/' }) {
  const title = category ? `${category} · Blog` : 'Blog';
  return layout({
    title: `${title} · Nas Quadras`,
    description: category ? `Textos sobre ${category} no blog Nas Quadras.` : 'Análises e textos de Pedro Rodrigues sobre basquete.',
    url: category ? `${origin}/blog/categoria/${categorySlug(category)}` : `${origin}/blog`,
    type: 'website',
    nav: 'blog',
    home,
    body: `<h1 class="page-title">${esc(title)}</h1>
      ${categoryNav(category)}
      ${articles.length ? `<div class="cards">${articles.map(articleCard).join('')}</div>` : '<p class="empty">Nenhum texto publicado aqui ainda.</p>'}`,
  });
}

export function articlePage({ a, origin, admin = false, related = [], home = '/' }) {
  const draft = a.status !== 'published';
  const when = a.published_at ? fmtDate(a.published_at) : 'Rascunho';
  const updated = a.published_at && a.updated_at - a.published_at > 60 * 60 * 1000
    ? ` · atualizado em ${shortDate(a.updated_at)}` : '';
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: a.title,
    description: excerpt(a),
    datePublished: a.published_at ? new Date(a.published_at).toISOString() : undefined,
    dateModified: new Date(a.updated_at).toISOString(),
    author: { '@type': 'Person', name: 'Pedro Rodrigues' },
    image: a.cover_key ? coverUrl(origin, a.cover_key) : undefined,
    mainEntityOfPage: `${origin}/blog/${a.slug}`,
  };
  return layout({
    title: `${a.title} · Nas Quadras`,
    description: excerpt(a),
    image: coverUrl(origin, a.cover_key),
    url: `${origin}/blog/${a.slug}`,
    nav: 'blog',
    home,
    head: `${draft ? '<meta name="robots" content="noindex">' : ''}<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`,
    body: `<article class="article">
      ${draft ? '<p class="draft-banner">Pré-visualização de rascunho — só você está vendo esta página.</p>' : ''}
      <p class="crumbs"><a href="/blog">Blog</a> · <a href="/blog/categoria/${categorySlug(a.category)}">${esc(a.category)}</a></p>
      <h1 class="article-title">${esc(a.title)}</h1>
      ${a.summary ? `<p class="lede">${esc(a.summary)}</p>` : ''}
      <p class="byline">Por <strong>Pedro Rodrigues</strong> · ${esc(when)}${updated} · ${readingMinutes(a.body_html)} min de leitura</p>
      ${a.cover_key ? `<img class="article-cover" src="/m/${esc(a.cover_key)}" alt="">` : ''}
      <div class="article-body prose">${a.body_html}</div>
      ${admin ? `<p class="admin-note"><a href="/app#blog/${a.id}">Editar no app</a></p>` : ''}
    </article>
    ${related.length ? `<section class="home-block"><header class="block-head"><h2>Leia também</h2></header><div class="cards">${related.map(articleCard).join('')}</div></section>` : ''}`,
  });
}

// ---------- Páginas fixas ----------

export function staticPage({ page, slug, origin, admin = false, home = '/' }) {
  const navKey = { sobre: 'sobre', coluna: 'coluna', 'zona-de-conforto': 'zona' }[slug];
  const body = page.body_html?.trim()
    ? page.body_html
    : `<p class="empty">${esc(PAGES[slug].placeholder)}</p>`;
  return layout({
    title: `${page.title} · Nas Quadras`,
    description: excerpt({ body_html: page.body_html }, 160) || PAGES[slug].placeholder,
    url: `${origin}/${slug}`,
    type: 'website',
    nav: navKey,
    home,
    body: `<article class="article">
      <h1 class="article-title">${esc(page.title)}</h1>
      <div class="article-body prose">${body}</div>
      ${admin ? `<p class="admin-note"><a href="/app#paginas/${slug}">Editar no app</a></p>` : ''}
    </article>`,
  });
}

// ---------- RSS e sitemap ----------

const xml = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

export function rssFeed({ articles, origin }) {
  const items = articles.map((a) => `<item>
  <title>${xml(a.title)}</title>
  <link>${origin}/blog/${xml(a.slug)}</link>
  <guid isPermaLink="true">${origin}/blog/${xml(a.slug)}</guid>
  <pubDate>${new Date(a.published_at).toUTCString()}</pubDate>
  <category>${xml(a.category)}</category>
  <description>${xml(excerpt(a, 400))}</description>
  ${a.body_html ? `<content:encoded><![CDATA[${String(a.body_html).replace(/]]>/g, ']]]]><![CDATA[>').replace(/(src|href)="\//g, `$1="${origin}/`)}]]></content:encoded>` : ''}
</item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Nas Quadras — Blog</title>
  <link>${origin}/blog</link>
  <atom:link href="${origin}/rss.xml" rel="self" type="application/rss+xml"/>
  <description>Basquete por Pedro Rodrigues</description>
  <language>pt-BR</language>
${items}
</channel>
</rss>`;
}

export function sitemap({ articles, games, origin }) {
  const url = (loc, ms) => `<url><loc>${xml(loc)}</loc>${ms ? `<lastmod>${new Date(ms).toISOString()}</lastmod>` : ''}</url>`;
  const fixed = ['/', '/blog', '/c', '/coluna', '/zona-de-conforto', '/sobre'].map((p) => url(`${origin}${p}`));
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...fixed,
    ...articles.map((a) => url(`${origin}/blog/${a.slug}`, a.updated_at)),
    ...games.map((g) => url(`${origin}/c/${g.slug}`, g.updated_at))].join('\n')}
</urlset>`;
}

// ---------- Coluna Nas Quadras (cards com link para o texto original) ----------

function columnCard(c) {
  const img = c.image_key ? `/m/${esc(c.image_key)}` : (c.image_url ? esc(c.image_url) : '');
  return `<a class="column-card" href="${esc(c.url)}" target="_blank" rel="noopener">
    ${img ? `<img loading="lazy" src="${img}" alt="">` : '<div class="card-ph" aria-hidden="true"></div>'}
    <div class="column-body">
      <span class="card-date">${esc(c.source)} · ${shortDate(c.published_at)}</span>
      <strong>${esc(c.title)}</strong>
      ${c.summary ? `<span class="card-excerpt">${esc(c.summary)}</span>` : ''}
      <span class="column-cta">Ler no ${esc(c.source)} ↗</span>
    </div>
  </a>`;
}

export function columnPage({ columns, page, origin, admin = false, home = '/' }) {
  const intro = page?.body_html?.trim() ? `<div class="prose column-intro">${page.body_html}</div>` : '';
  return layout({
    title: `${page?.title || 'Coluna Nas Quadras'} · Nas Quadras`,
    description: 'A coluna Nas Quadras, de Pedro Rodrigues, no Jornal do Brasil: NBA, NBB e o basquete brasileiro.',
    url: `${origin}/coluna`,
    type: 'website',
    nav: 'coluna',
    home,
    body: `<h1 class="page-title">${esc(page?.title || 'Coluna Nas Quadras')}</h1>
      ${intro || '<p class="lede">Toda semana no Jornal do Brasil: NBA, NBB e o basquete brasileiro.</p>'}
      ${columns.length
        ? `<div class="column-list">${columns.map(columnCard).join('')}</div>`
        : '<p class="empty">As colunas publicadas vão aparecer aqui.</p>'}
      ${admin ? '<p class="admin-note"><a href="/app#coluna">Adicionar coluna no app</a></p>' : ''}`,
  });
}

export { columnCard };
