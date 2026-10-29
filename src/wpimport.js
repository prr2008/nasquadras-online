// Importação dos posts do WordPress.com (prr2008.wordpress.com) para o blog.
// Usa a API pública do WordPress.com (sem senha). Preserva a data de
// publicação; copia as fotos para o R2; mantém vídeos do YouTube/Spotify/
// VideoPress como player e os posts do X e do Instagram incorporados.
// Roda em lotes pequenos (limite de chamadas externas por requisição do Worker).

import * as blog from './blog.js';

const WPAPI = 'https://public-api.wordpress.com/rest/v1.1/sites';
const UA = 'Mozilla/5.0 (compatible; NasQuadrasOnline/1.0; +https://nasquadras.online)';
const IMG_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_IMAGE = 15 * 1024 * 1024;
const mapKey = (site, id) => `wp:import:${site}:${id}`;

export function siteHost(input) {
  const s = String(input || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) throw new Error('Endereço do WordPress inválido (ex.: prr2008.wordpress.com).');
  return s;
}

const decode = (s) => String(s || '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&hellip;/g, '…').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&amp;/g, '&');
const text = (html) => decode(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// ---------- Categoria pelo assunto ----------

const NBB_RE = /\b(NBB|LNB|Flamengo|Fla\b|Franca|Minas|Paulistano|Pinheiros|Botafogo|Vasco|Corinthians|Bauru|Brasília|Unifacisa|Caxias|Mogi|São José|Sesi|Pato|Cearense|Fortaleza|Liga Sul-Americana|Champions League Américas|BCLA|Maracanãzinho|Tijuca)\b/gi;
const NBA_RE = /\b(NBA|Celtics|Lakers|Knicks|Thunder|Pacers|Warriors|Nuggets|Bulls|Heat|Spurs|Mavericks|Timberwolves|Cavaliers|Bucks|76ers|Sixers|Nets|Clippers|Suns|Rockets|Grizzlies|Kings|Pelicans|Hawks|Magic|Raptors|Pistons|Hornets|Wizards|Jazz|Blazers|LeBron|Curry|Jokic|Luka|Wembanyama|Brunson|Tatum)\b/gi;

export function guessCategory(post) {
  const wpCats = Object.keys(post.categories || {}).map((c) => c.toLowerCase());
  const t = `${post.title} ${text(post.content)}`;
  if (/sele[cç][aã]o/i.test(post.title)) return 'Seleção';
  if (/\b(feminino|LBF|WNBA)\b/i.test(post.title)) return 'Basquete feminino';
  const nbb = (t.match(NBB_RE) || []).length + (wpCats.some((c) => ['nbb', 'flamengo'].includes(c)) ? 5 : 0);
  const nba = (t.match(NBA_RE) || []).length + (wpCats.includes('playoffs') ? 2 : 0);
  if (!nbb && !nba) return 'Opinião';
  return nba > nbb ? 'NBA' : 'NBB';
}

// ---------- Conversão do HTML ----------

const YT_ID = /(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/;

/** Link solto (como o WordPress guarda alguns embeds) -> marcação de player/post. */
function embedFromUrl(url) {
  const u = decode(url).trim();
  let m = u.match(YT_ID);
  if (m) return `<iframe src="https://www.youtube.com/embed/${m[1]}"></iframe>`;
  m = u.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(?:embed\/)?(episode|show|track|playlist|album)\/(\w+)/);
  if (m) return `<iframe src="https://open.spotify.com/embed/${m[1]}/${m[2]}"></iframe>`;
  m = u.match(/^https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/(\w+)\/status\/(\d+)/);
  if (m) return `<blockquote class="twitter-tweet"><a href="https://twitter.com/${m[1]}/status/${m[2]}">https://twitter.com/${m[1]}/status/${m[2]}</a></blockquote>`;
  m = u.match(/^https?:\/\/(?:www\.)?instagram\.com\/(p|reel|tv)\/([\w-]+)/);
  if (m) return `<blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/${m[1]}/${m[2]}/"><a href="https://www.instagram.com/${m[1]}/${m[2]}/">Ver este post no Instagram</a></blockquote>`;
  // Podcast no Anchor / Spotify for Podcasters.
  m = u.match(/^https?:\/\/anchor\.fm\/([\w-]+)\/(?:embed\/)?episodes\/([\w-]+)/);
  if (m) return `<iframe src="https://anchor.fm/${m[1]}/embed/episodes/${m[2]}"></iframe>`;
  m = u.match(/^https?:\/\/(podcasters|creators)\.spotify\.com\/pod\/(show|profile)\/([\w-]+)\/(?:embed\/)?episodes\/([\w-]+)/);
  if (m) return `<iframe src="https://${m[1]}.spotify.com/pod/${m[2]}/${m[3]}/embed/episodes/${m[4]}"></iframe>`;
  m = u.match(/^https?:\/\/(?:videopress\.com\/v\/|video\.wordpress\.com\/v\/)(\w+)/);
  if (m) return `<iframe src="https://videopress.com/embed/${m[1]}"></iframe>`;
  return null;
}

/** Ajustes de texto antes da limpeza geral (scripts, embeds, links internos). */
export function prepareHtml(html) {
  let h = String(html || '');
  h = h.replace(/<script[\s\S]*?<\/script>/gi, '');
  // Embed guardado só como link dentro do invólucro do WordPress.
  h = h.replace(/<div class="wp-block-embed__wrapper">\s*(https?:\/\/[^\s<]+)\s*<\/div>/g, (whole, url) => embedFromUrl(url) || `<p><a href="${url}">${url}</a></p>`);
  // Link solto numa linha (oEmbed clássico).
  h = h.replace(/<p>\s*(https?:\/\/[^\s<]+)\s*<\/p>/g, (whole, url) => embedFromUrl(url) || whole);
  // Instagram: endereço limpo (sem utm), que é o que o sanitizador aceita.
  h = h.replace(/data-instgrm-permalink="https?:\/\/(?:www\.)?instagram\.com\/(p|reel|tv)\/([\w-]+)[^"]*"/g, 'data-instgrm-permalink="https://www.instagram.com/$1/$2/"');
  // X: tira o rastreamento do link do post.
  h = h.replace(/(https:\/\/(?:twitter|x)\.com\/\w+\/status\/\d+)\?ref_src=[^"]*/g, '$1');
  // Foto dentro de link para o próprio arquivo: fica só a foto.
  h = h.replace(/<a [^>]*href="[^"]+\.(?:jpe?g|png|gif|webp)(?:\?[^"]*)?"[^>]*>\s*(<img [^>]*>)\s*<\/a>/gi, '$1');
  return h;
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`, 'i'));
  return m ? decode(m[1]) : '';
};

/** URL da foto em boa resolução (o CDN do WordPress redimensiona com ?w=). */
function bestImageUrl(tag) {
  let url = attr(tag, 'data-orig-file') || attr(tag, 'src');
  if (!/^https?:\/\//.test(url)) return null;
  if (/(\.files\.wordpress\.com|\.wordpress\.com\/wp-content\/uploads|i\d\.wp\.com)/.test(url)) url = `${url.split('?')[0]}?w=1600`;
  return url;
}

async function copyImage(env, url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const type = (res.headers.get('Content-Type') || '').split(';')[0].trim();
  const ext = IMG_EXT[type];
  if (!res.ok || !ext) throw new Error(`foto não baixou (${res.status})`);
  const buf = await res.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > MAX_IMAGE) throw new Error('foto grande demais');
  const key = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
  await env.MEDIA.put(key, buf, { httpMetadata: { contentType: type } });
  return key;
}

/** Converte um post: devolve o HTML pronto, a capa e um resumo do que foi feito. */
export async function convertPost(env, post, { dryRun = false } = {}) {
  let html = prepareHtml(post.content);
  const report = { images: 0, imageErrors: [], youtube: 0, spotify: 0, videopress: 0, x: 0, instagram: 0 };
  let cover = null;

  const tags = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  for (const tag of tags) {
    const url = bestImageUrl(tag);
    let replacement = '';
    if (url) {
      try {
        const key = dryRun ? 'simulacao' : await copyImage(env, url);
        cover ||= key;
        report.images++;
        replacement = `<img src="/m/${key}" alt="${attr(tag, 'alt').replace(/"/g, '&quot;')}">`;
      } catch (err) {
        report.imageErrors.push(`${url.split('?')[0]}: ${err.message}`);
      }
    }
    html = html.replace(tag, replacement);
  }

  report.youtube = (html.match(/youtube(?:-nocookie)?\.com\/embed\//g) || []).length;
  report.spotify = (html.match(/open\.spotify\.com\/embed\//g) || []).length;
  report.videopress = (html.match(/(videopress\.com|video\.wordpress\.com)\/embed\//g) || []).length;
  report.podcast = (html.match(/(anchor\.fm|(podcasters|creators)\.spotify\.com)\/[^"]*\/embed\//g) || []).length;
  report.x = (html.match(/class="twitter-tweet/g) || []).length;
  report.instagram = (html.match(/class="instagram-media/g) || []).length;

  // Sem foto: a miniatura do primeiro vídeo do YouTube vira a capa.
  if (!cover) {
    const yt = html.match(YT_ID);
    if (yt) {
      try { cover = dryRun ? 'simulacao' : await copyImage(env, `https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg`); report.coverFromYoutube = true; } catch { /* sem capa */ }
    }
  }
  // A capa aparece acima do texto: se o post começa com essa mesma foto, ela sai do corpo.
  if (cover && !report.coverFromYoutube) {
    html = html.replace(new RegExp(`^\\s*(<figure[^>]*>\\s*)?<img src="/m/${cover}"[^>]*>(\\s*<figcaption>[\\s\\S]*?</figcaption>)?(\\s*</figure>)?`), '');
  }
  return { html, cover: dryRun ? null : cover, report };
}

// ---------- Importação em lotes ----------

async function fetchPosts(host, offset, number) {
  const q = new URLSearchParams({
    number: String(number), offset: String(offset), order: 'ASC', order_by: 'date', status: 'publish',
    fields: 'ID,date,title,slug,content,excerpt,categories,URL',
  });
  const res = await fetch(`${WPAPI}/${host}/posts?${q}`, { headers: { 'User-Agent': UA } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`WordPress: ${data.message || data.error || `HTTP ${res.status}`}`);
  return data;
}

/** Importa até `limit` posts a partir de `offset` (do mais antigo para o mais novo). */
export async function importBatch(env, { site, offset = 0, limit = 3, dryRun = false }) {
  const host = siteHost(site);
  const data = await fetchPosts(host, offset, Math.min(Math.max(limit, 1), 5));
  const results = [];
  for (const post of data.posts || []) {
    const title = text(post.title) || '(sem título)';
    const base = { wpId: post.ID, title, date: post.date, url: post.URL };
    try {
      const existing = await env.KV.get(mapKey(host, post.ID));
      if (existing && !dryRun) { results.push({ ...base, skipped: true, articleId: Number(existing) }); continue; }
      const { html, cover, report } = await convertPost(env, post, { dryRun });
      const category = guessCategory({ ...post, title });
      const summary = text(post.excerpt).replace(/\s*(Continue reading|Leia mais|Continuar lendo)[\s\S]*$/i, '').replace(/\s*\[…\]\s*$/, '…').slice(0, 300);
      const slug = decodeURIComponent(post.slug || '');
      if (dryRun) { results.push({ ...base, category, slug, report, simulated: true }); continue; }
      const a = await blog.importArticle(env, {
        title, summary, body_html: html, cover_key: cover, category, slug, published_at: Date.parse(post.date),
      });
      await env.KV.put(mapKey(host, post.ID), String(a.id));
      results.push({ ...base, articleId: a.id, slug: a.slug, category, report });
    } catch (err) {
      results.push({ ...base, error: err.message });
    }
  }
  const next = offset + (data.posts || []).length;
  return { found: data.found, offset, next, done: next >= data.found || !(data.posts || []).length, results };
}
