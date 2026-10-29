// Páginas do site principal: Início, Blog, artigo, categoria, páginas fixas, RSS e sitemap.

import { layout, esc, fmtDate, PERIOD_LABEL, SOCIAL, SUBSTACK } from './site.js';
import { CATEGORIES, PAGES, categorySlug, excerpt, readingMinutes } from './blog.js';
import { episodeLabel } from './zona.js';

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

// ---------- Destaques do Início: coberturas e coluna ----------

function featureCoverage(games) {
  const [main, ...rest] = games;
  const head = '<header class="block-head"><h2>Coberturas</h2><a href="/c">Ver todas →</a></header>';
  if (!main) return `<section class="feature">${head}<p class="empty">As coberturas ao vivo vão aparecer aqui.</p></section>`;
  const score = (g) => (g.home ? `${esc(g.home)} <b>${g.home_score ?? 0}</b> x <b>${g.away_score ?? 0}</b> ${esc(g.away)}` : '');
  const status = main.status === 'live' && main.period !== 'FINAL' ? '<span class="live-pill">Ao vivo</span>' : (main.period === 'FINAL' || main.status === 'ended') ? '<span class="tag">Final</span>' : '';
  return `<section class="feature">
    ${head}
    <a class="feature-main" href="/c/${esc(main.slug)}">
      ${main.cover_key ? `<img src="/m/${esc(main.cover_key)}" alt="" loading="lazy">` : '<div class="card-ph feature-ph" aria-hidden="true"><span class="ball"></span></div>'}
      <div class="feature-body">
        <span class="card-date">${shortDate(main.started_at)} ${status}</span>
        <strong>${esc(main.title)}</strong>
        ${main.home ? `<span class="feature-score">${score(main)}</span>` : ''}
        <span class="column-cta">${main.n_posts ? `${main.n_posts} posts · ` : ''}Ver a cobertura →</span>
      </div>
    </a>
    ${rest.length ? `<ul class="feature-list">${rest.map((g) => `<li><a href="/c/${esc(g.slug)}"><span class="card-date">${shortDate(g.started_at)}</span><span>${esc(g.title)}</span>${g.home ? `<span class="card-score">${score(g)}</span>` : ''}</a></li>`).join('')}</ul>` : ''}
  </section>`;
}

function featureColumn(columns) {
  const [main, ...rest] = columns;
  const head = '<header class="block-head"><h2>Coluna Nas Quadras</h2><a href="/coluna">Ver todas →</a></header>';
  if (!main) return `<section class="feature">${head}<p class="empty">Toda semana no Jornal do Brasil.</p></section>`;
  const img = main.image_key ? `/m/${esc(main.image_key)}` : (main.image_url ? esc(main.image_url) : '');
  return `<section class="feature">
    ${head}
    <a class="feature-main" href="${esc(main.url)}" target="_blank" rel="noopener">
      ${img ? `<img src="${img}" alt="" loading="lazy">` : '<div class="card-ph feature-ph" aria-hidden="true"></div>'}
      <div class="feature-body">
        <span class="card-date">${esc(main.source)} · ${shortDate(main.published_at)}</span>
        <strong>${esc(main.title)}</strong>
        ${main.summary ? `<span class="card-excerpt">${esc(main.summary)}</span>` : ''}
        <span class="column-cta">Ler no ${esc(main.source)} ↗</span>
      </div>
    </a>
    ${rest.length ? `<ul class="feature-list">${rest.map((c) => `<li><a href="${esc(c.url)}" target="_blank" rel="noopener"><span class="card-date">${shortDate(c.published_at)}</span><span>${esc(c.title)}</span></a></li>`).join('')}</ul>` : ''}
  </section>`;
}

export function homePage({ games, articles, origin, home = '/', columns = [], latestEpisode = null }) {
  const live = games.find((g) => g.status === 'live' && g.period !== 'FINAL');
  const liveBlock = live ? `<section class="live-hero">
      <a href="/c/${esc(live.slug)}" class="live-hero-link">
        <span class="live-pill">Ao vivo agora</span>
        <strong>${esc(live.title)}</strong>
        ${live.home ? `<span class="hero-score">${esc(live.home)} <b>${live.home_score ?? 0}</b> x <b>${live.away_score ?? 0}</b> ${esc(live.away)} · ${esc(PERIOD_LABEL[live.period] || '')}</span>` : ''}
        <span class="hero-cta">Acompanhar a cobertura →</span>
      </a>
    </section>` : '';

  const coverages = games.filter((g) => g !== live).slice(0, 4);
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
      <div class="features">
        ${featureCoverage(coverages)}
        ${featureColumn(columns)}
      </div>
      <div class="home-grid">
      <div class="home-main">
      <section class="home-block">
        <header class="block-head"><h2>Do blog</h2><a href="/blog">Ver todos →</a></header>
        ${articles.length ? `<div class="cards">${articles.slice(0, 6).map(articleCard).join('')}</div>` : '<p class="empty">Os primeiros textos estão a caminho.</p>'}
      </section>
      </div>
      <aside class="home-side">
      <section class="home-block promo">
        <a class="promo-card" href="/zona-de-conforto"><strong>Zona de Conforto</strong><span>${latestEpisode ? `Playlist mais recente: ${esc(episodeLabel(latestEpisode))}` : 'Música, cultura e esporte'}</span></a>
      </section>
      ${newsletterBox()}
      <section class="home-block follow">
        <h2>Siga</h2>
        <ul>
          ${SOCIAL.map(([n, u]) => `<li><a href="${u}" rel="me noopener" target="_blank">${n}</a></li>`).join('')}
          <li><a href="https://www.jb.com.br/esportes/nas-quadras" rel="noopener" target="_blank">Coluna no JB</a></li>
        </ul>
      </section>
      </aside>
      </div>`,
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

/** Scripts do X e do Instagram, só nas páginas que têm posts deles incorporados. */
function socialScripts(html) {
  const out = [];
  if (/class="twitter-tweet"/.test(html)) out.push('<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>');
  if (/class="instagram-media"/.test(html)) out.push('<script async src="https://www.instagram.com/embed.js"></script>');
  return out.join('');
}

/** Caixa de inscrição na newsletter (formulário oficial do Substack). */
export function newsletterBox({ title = 'Newsletter', text = 'Receba os textos, as coberturas e as playlists do Zona de Conforto no seu e-mail. É de graça.' } = {}) {
  return `<section class="home-block newsletter" id="newsletter">
    <h2>${esc(title)}</h2>
    <p>${esc(text)}</p>
    <iframe src="${SUBSTACK}/embed" title="Inscrição na newsletter de Pedro Rodrigues no Substack" loading="lazy" scrolling="no" frameborder="0"></iframe>
    <a class="newsletter-link" href="${SUBSTACK}" target="_blank" rel="noopener">Ver as edições no Substack ↗</a>
  </section>`;
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
    ${socialScripts(a.body_html)}
    ${draft ? '' : newsletterBox({ title: 'Gostou? Assine a newsletter' })}
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
    </article>
    ${slug === 'sobre' ? newsletterBox() : ''}`,
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

// ---------- Zona de Conforto ----------

function episodeCard(e) {
  const id = esc(e.playlist_id);
  return `<article class="episode" id="ep-${e.id}">
    <header>
      <span class="card-date">${esc(episodeLabel(e))}</span>
      ${e.title ? `<h2>${esc(e.title)}</h2>` : ''}
      ${e.summary ? `<p class="card-excerpt">${esc(e.summary)}</p>` : ''}
    </header>
    <iframe class="spotify" src="https://open.spotify.com/embed/playlist/${id}?utm_source=generator&amp;theme=0"
      title="Playlist: ${esc(e.playlist_name || episodeLabel(e))}" loading="lazy"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>
    <a class="column-cta" href="https://open.spotify.com/playlist/${id}" target="_blank" rel="noopener">Abrir no Spotify ↗</a>
  </article>`;
}

export function zonaPage({ page, episodes, origin, admin = false, home = '/' }) {
  const intro = page?.body_html?.trim()
    ? `<div class="prose column-intro">${page.body_html}</div>`
    : '<p class="lede">Música, cultura e esporte. Às terças na rádio web Internova, com reprise aos sábados. Aqui ficam as playlists de cada edição.</p>';
  return layout({
    title: `${page?.title || 'Zona de Conforto'} · Nas Quadras`,
    description: 'Zona de Conforto: música, cultura e esporte com Pedro Rodrigues. As playlists de cada edição do programa.',
    url: `${origin}/zona-de-conforto`,
    type: 'website',
    nav: 'zona',
    home,
    body: `<h1 class="page-title">${esc(page?.title || 'Zona de Conforto')}</h1>
      ${intro}
      ${episodes.length
        ? `<h2 class="section-title">Edições</h2><div class="episodes">${episodes.map(episodeCard).join('')}</div>`
        : '<p class="empty">As playlists das edições vão aparecer aqui.</p>'}
      ${admin ? '<p class="admin-note"><a href="/app#zona">Adicionar edição no app</a> · <a href="/app#paginas/zona-de-conforto">Editar apresentação</a></p>' : ''}`,
  });
}
