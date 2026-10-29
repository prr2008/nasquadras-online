// Blog e páginas fixas do site: dados (D1) e limpeza do HTML do editor visual.

export const CATEGORIES = ['NBB', 'NBA', 'Seleção', 'Basquete feminino', 'Opinião', 'Outros'];

export const PAGES = {
  sobre: { title: 'Sobre', placeholder: 'Em breve: quem é Pedro Rodrigues e o que é o Nas Quadras.' },
  coluna: { title: 'Coluna Nas Quadras', placeholder: 'Texto de apresentação (opcional), exibido acima das colunas. As colunas em si são adicionadas na aba Coluna.' },
  'zona-de-conforto': { title: 'Zona de Conforto', placeholder: 'Texto de apresentação (opcional), exibido acima das edições. As edições, com as playlists, são adicionadas na aba Zona.' },
};

// ---------- Limpeza de HTML (só o que o editor produz passa) ----------

const ALLOWED = {
  p: [], br: [], h2: [], h3: [], h4: [],
  strong: [], b: [], em: [], i: [], u: [], s: [],
  blockquote: ['class', 'data-instgrm-permalink'], ul: [], ol: [], li: [], hr: [],
  pre: [], code: [],
  a: ['href'],
  img: ['src', 'alt', 'width', 'height'],
  iframe: ['src'],
  figure: [], figcaption: [],
};
const DROP = new Set(['script', 'style', 'noscript', 'template', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'svg', 'math', 'link', 'meta', 'base']);
const SAFE_HREF = /^(https?:\/\/|mailto:|\/(?!\/)|#)/i;
const SAFE_IMG = /^(\/m\/[0-9]{13}-[0-9a-f-]{36}\.(jpg|png|webp|gif)|https:\/\/[^\s"'<>]+)$/i;
const SAFE_IFRAME = /^https:\/\/(www\.youtube(-nocookie)?\.com\/embed\/[\w-]+|open\.spotify\.com\/embed\/(episode|show|track|playlist|album)\/[\w]+|player\.vimeo\.com\/video\/\d+|(videopress\.com|video\.wordpress\.com)\/embed\/[\w]+)/i;
const SAFE_IG = /^https:\/\/www\.instagram\.com\/(p|reel|tv)\/[\w-]+\/?(\?[\w=&.%-]*)?$/;

/**
 * Limpa o HTML do editor com o HTMLRewriter dos Workers: remove scripts,
 * estilos, eventos e atributos desconhecidos; mantém só formatação de texto,
 * links seguros, imagens do próprio site e vídeos do YouTube/Spotify/Vimeo.
 */
const EMBED_LINK_RE = /<a [^>]*href="(https:\/\/(?:www\.youtube(?:-nocookie)?\.com\/embed\/|open\.spotify\.com\/embed\/|player\.vimeo\.com\/video\/)[^"]+)"[^>]*>\s*\1\s*<\/a>/g;

export async function sanitizeHtml(html) {
  html = String(html || '').replace(EMBED_LINK_RE, (_, src) => `<iframe src="${src}"></iframe>`);
  const rewriter = new HTMLRewriter()
    .on('*', {
      element(el) {
        const tag = el.tagName.toLowerCase();
        if (DROP.has(tag)) { el.remove(); return; }
        const allowed = ALLOWED[tag];
        if (!allowed) { el.removeAndKeepContent(); return; }
        const attrs = [...el.attributes].map(([name, value]) => [name.toLowerCase(), value]);
        for (const [name] of attrs) if (!allowed.includes(name)) el.removeAttribute(name);
        const get = (n) => attrs.find(([k]) => k === n)?.[1] || '';

        if (tag === 'a') {
          const href = get('href').trim();
          if (!SAFE_HREF.test(href)) { el.removeAndKeepContent(); return; }
          if (/^https?:/i.test(href)) {
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'noopener nofollow');
          }
        }
        // Posts do X e do Instagram incorporados: só as classes deles e o
        // endereço do Instagram validado; o resto vira citação comum.
        if (tag === 'blockquote') {
          const cls = get('class');
          el.removeAttribute('class');
          el.removeAttribute('data-instgrm-permalink');
          if (/\btwitter-tweet\b/.test(cls)) el.setAttribute('class', 'twitter-tweet');
          else if (/\binstagram-media\b/.test(cls) && SAFE_IG.test(get('data-instgrm-permalink').trim())) {
            el.setAttribute('class', 'instagram-media');
            el.setAttribute('data-instgrm-permalink', get('data-instgrm-permalink').trim());
          }
        }
        if (tag === 'img') {
          if (!SAFE_IMG.test(get('src').trim())) { el.remove(); return; }
          el.setAttribute('loading', 'lazy');
        }
        if (tag === 'iframe') {
          if (!SAFE_IFRAME.test(get('src').trim())) { el.remove(); return; }
          el.setAttribute('loading', 'lazy');
          el.setAttribute('allowfullscreen', '');
          el.setAttribute('allow', 'encrypted-media; picture-in-picture');
          el.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        }
      },
      comments(c) { c.remove(); },
    });
  const out = await rewriter.transform(new Response(String(html || ''), { headers: { 'Content-Type': 'text/html' } })).text();
  return out
    .replace(/&nbsp;/g, ' ')
    .replace(/<p>\s*(<br>)?\s*<\/p>/g, '') // parágrafos vazios do editor
    .trim();
}

export const stripTags = (html) => String(html || '')
  .replace(/<\/(p|h[2-4]|li|blockquote)>/g, ' ')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ').trim();

export function excerpt(article, n = 220) {
  const s = article.summary?.trim() || stripTags(article.body_html);
  return s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, '')}…` : s;
}

export const readingMinutes = (html) => Math.max(1, Math.round(stripTags(html).split(' ').filter(Boolean).length / 200));

export function slugify(title) {
  return String(title || 'artigo')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'artigo';
}

export const categorySlug = (c) => slugify(c);

/** Chaves de mídia usadas em artigos e páginas (para a limpeza diária não apagar). */
export async function referencedKeys(env) {
  const keys = new Set();
  const { results: arts } = await env.DB.prepare('SELECT cover_key, body_html FROM articles').all();
  const { results: pages } = await env.DB.prepare('SELECT body_html FROM pages').all();
  for (const r of [...arts, ...pages]) {
    if (r.cover_key) keys.add(r.cover_key);
    for (const m of String(r.body_html || '').matchAll(/\/m\/([0-9]{13}-[0-9a-f-]{36}\.[a-z0-9]+)/g)) keys.add(m[1]);
  }
  return keys;
}

// ---------- Artigos ----------

const COLS = 'id, slug, title, summary, cover_key, category, status, published_at, created_at, updated_at';

async function uniqueSlug(env, base, exceptId = 0) {
  let slug = base;
  for (let i = 2; i < 50; i++) {
    const row = await env.DB.prepare('SELECT id FROM articles WHERE slug = ? AND id != ?').bind(slug, exceptId).first();
    if (!row) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${Date.now()}`;
}

function clean(input) {
  return {
    title: String(input.title || '').trim().slice(0, 160),
    summary: String(input.summary || '').trim().slice(0, 300),
    category: CATEGORIES.includes(input.category) ? input.category : 'Opinião',
    cover_key: /^[0-9]{13}-[0-9a-f-]{36}\.(jpg|png|webp|gif)$/.test(input.cover_key || '') ? input.cover_key : null,
    status: input.status === 'published' ? 'published' : 'draft',
  };
}

export async function createArticle(env, input) {
  const a = clean(input);
  if (!a.title) throw new Error('O artigo precisa de um título.');
  const body = await sanitizeHtml(input.body_html);
  const now = Date.now();
  const slug = await uniqueSlug(env, slugify(a.title));
  const res = await env.DB.prepare(
    `INSERT INTO articles (slug, title, summary, body_html, cover_key, category, status, published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(slug, a.title, a.summary, body, a.cover_key, a.category, a.status, a.status === 'published' ? now : null, now, now).run();
  return getArticleById(env, res.meta.last_row_id);
}

export async function updateArticle(env, id, input) {
  const cur = await getArticleById(env, id);
  if (!cur) return null;
  const a = clean(input);
  if (!a.title) throw new Error('O artigo precisa de um título.');
  const body = await sanitizeHtml(input.body_html);
  const now = Date.now();
  // O endereço só muda enquanto o artigo é rascunho: depois de publicado, links compartilhados continuam valendo.
  const slug = cur.status === 'draft' && !cur.published_at ? await uniqueSlug(env, slugify(a.title), id) : cur.slug;
  const publishedAt = a.status === 'published' ? (cur.published_at || now) : cur.published_at;
  await env.DB.prepare(
    `UPDATE articles SET slug = ?, title = ?, summary = ?, body_html = ?, cover_key = ?, category = ?, status = ?,
       published_at = ?, updated_at = ? WHERE id = ?`,
  ).bind(slug, a.title, a.summary, body, a.cover_key, a.category, a.status, publishedAt, now, id).run();
  return getArticleById(env, id);
}

/**
 * Grava um artigo vindo de outro lugar (importação do WordPress), já publicado,
 * com a data original. O endereço tenta manter o do WordPress.
 */
export async function importArticle(env, input) {
  const a = clean({ ...input, status: 'published' });
  if (!a.title) throw new Error('Post sem título.');
  const body = await sanitizeHtml(input.body_html);
  const published = Number(input.published_at) || Date.now();
  const slug = await uniqueSlug(env, slugify(input.slug || a.title));
  const res = await env.DB.prepare(
    `INSERT INTO articles (slug, title, summary, body_html, cover_key, category, status, published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'published', ?, ?, ?)`,
  ).bind(slug, a.title, a.summary, body, a.cover_key, a.category, published, published, published).run();
  return getArticleById(env, res.meta.last_row_id);
}

export async function deleteArticle(env, id) {
  return (await env.DB.prepare('DELETE FROM articles WHERE id = ?').bind(id).run()).meta.changes > 0;
}

export async function getArticleById(env, id) {
  return env.DB.prepare('SELECT * FROM articles WHERE id = ?').bind(id).first();
}

export async function getArticleBySlug(env, slug, { includeDrafts = false } = {}) {
  const sql = includeDrafts
    ? 'SELECT * FROM articles WHERE slug = ?'
    : "SELECT * FROM articles WHERE slug = ? AND status = 'published'";
  return env.DB.prepare(sql).bind(slug).first();
}

/** Lista para o app (inclui rascunhos), sem o corpo do texto. */
export async function listAllArticles(env) {
  const { results } = await env.DB.prepare(`SELECT ${COLS} FROM articles ORDER BY COALESCE(published_at, updated_at) DESC LIMIT 300`).all();
  return results;
}

/** Artigos publicados, mais recentes primeiro; opcionalmente de uma categoria. */
export async function listPublished(env, { category = null, limit = 50, withBody = false } = {}) {
  const cols = withBody ? '*' : COLS;
  const { results } = category
    ? await env.DB.prepare(`SELECT ${cols} FROM articles WHERE status = 'published' AND category = ? ORDER BY published_at DESC LIMIT ?`).bind(category, limit).all()
    : await env.DB.prepare(`SELECT ${cols} FROM articles WHERE status = 'published' ORDER BY published_at DESC LIMIT ?`).bind(limit).all();
  return results;
}

// ---------- Páginas fixas ----------

export async function getPage(env, slug) {
  if (!PAGES[slug]) return null;
  const row = await env.DB.prepare('SELECT * FROM pages WHERE slug = ?').bind(slug).first();
  return row || { slug, title: PAGES[slug].title, body_html: '', updated_at: null };
}

export async function listPages(env) {
  return Promise.all(Object.keys(PAGES).map((slug) => getPage(env, slug)));
}

export async function savePage(env, slug, { title, body_html }) {
  if (!PAGES[slug]) throw new Error('Página desconhecida.');
  const body = await sanitizeHtml(body_html);
  const t = String(title || PAGES[slug].title).trim().slice(0, 120) || PAGES[slug].title;
  await env.DB.prepare(
    `INSERT INTO pages (slug, title, body_html, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET title = excluded.title, body_html = excluded.body_html, updated_at = excluded.updated_at`,
  ).bind(slug, t, body, Date.now()).run();
  return getPage(env, slug);
}
