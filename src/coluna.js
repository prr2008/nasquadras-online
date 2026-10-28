// Coluna Nas Quadras: a partir do link completo de uma coluna publicada
// (Jornal do Brasil ou outro site), lê título, foto, data e o início do texto,
// e guarda um card que leva o leitor ao texto original.

const UA = 'Mozilla/5.0 (compatible; NasQuadrasOnline/1.0; +https://nasquadras.online)';
const MAX_IMAGE = 10 * 1024 * 1024;
const IMG_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

// Entidades nomeadas comuns em textos em português.
const NAMED = {
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  agrave: 'à', Agrave: 'À', acirc: 'â', ecirc: 'ê', ocirc: 'ô', Acirc: 'Â', Ecirc: 'Ê', Ocirc: 'Ô',
  atilde: 'ã', otilde: 'õ', Atilde: 'Ã', Otilde: 'Õ', ccedil: 'ç', Ccedil: 'Ç', uuml: 'ü', Uuml: 'Ü',
  ordm: 'º', ordf: 'ª', deg: '°', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', middot: '·', bull: '•', euro: '€', copy: '©', reg: '®',
};

const decode = (s) => String(s || '')
  .replace(/&([A-Za-z]+);/g, (m, n) => NAMED[n] ?? m)
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

const cut = (s, n) => (s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, '')}…` : s);

/** "2026-10-24 11:05:00" ou "2026-10-24" (horário de Brasília) -> epoch ms. */
export function parseDate(s) {
  const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?(Z|[+-]\d{2}:?\d{2})?/);
  if (!m) return null;
  const [, y, mo, d, h = '12', mi = '00', se = '00', tz] = m;
  const zone = tz ? (tz === 'Z' ? 'Z' : tz.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')) : '-03:00';
  const t = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${se}${zone}`);
  return Number.isFinite(t) ? t : null;
}

export function validUrl(input) {
  let u;
  try { u = new URL(String(input || '').trim()); } catch { throw new Error('Cole o link completo da coluna (começando com https://).'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('O link precisa começar com https://');
  u.hash = '';
  for (const p of [...u.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$/.test(p)) u.searchParams.delete(p);
  return u.toString();
}

/** Lê os metadados da página (Open Graph + primeiro parágrafo do texto). */
export async function fetchPreview(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`Não consegui abrir a página (HTTP ${res.status}). Confira o link.`);

  const meta = {};
  let title = '';
  const paras = [];

  const rewriter = new HTMLRewriter()
    .on('meta', {
      element(e) {
        const k = (e.getAttribute('property') || e.getAttribute('name') || '').toLowerCase();
        const c = e.getAttribute('content');
        if (!k || !c) return;
        // Quando a data aparece duas vezes, fica a versão com horário.
        if (k === 'article:published_time' && meta[k] && meta[k].length >= c.length) return;
        if (!(k in meta) || k === 'article:published_time') meta[k] = c;
      },
    })
    .on('title', { text(t) { title += t.text; } })
    // Texto do corpo: JB (.materia-corpo) e páginas genéricas (<article>).
    .on('.materia-corpo p, article p', {
      element() { if (paras.length < 4) paras.push(''); },
      text(t) {
        if (paras.length && paras.length <= 4) paras[paras.length - 1] += t.text;
      },
    });
  await rewriter.transform(res).arrayBuffer();

  const desc = decode(meta['og:description'] || meta.description || '');
  // Resumo: o primeiro parágrafo, ou os primeiros juntos se ele for curto demais.
  const clean = paras.map(decode).filter((x) => x.length > 0);
  let bodyText = clean[0] || '';
  for (let i = 1; i < clean.length && bodyText.length < 120; i++) bodyText += ` ${clean[i]}`;
  const summary = desc.replace(/\./g, '').trim().length >= 20 ? desc : bodyText;
  const published = parseDate(meta['article:published_time'] || meta['og:published_time'] || meta.date) || Date.now();
  const site = decode(meta['og:site_name'] || '') || new URL(url).hostname.replace(/^www\./, '');

  return {
    url: validUrl(meta['og:url'] && /^https?:/.test(meta['og:url']) ? meta['og:url'] : url),
    title: decode(meta['og:title'] || meta['twitter:title'] || title).replace(/\s*[-|–]\s*Jornal do Brasil$/i, ''),
    summary: cut(summary, 260),
    image_url: meta['og:image'] || meta['twitter:image:src'] || meta['twitter:image'] || null,
    source: site,
    published_at: published,
  };
}

/** Copia a foto para o R2, para o card não depender do site de origem. */
async function copyImage(env, imageUrl) {
  if (!imageUrl || !/^https?:\/\//.test(imageUrl)) return null;
  try {
    const res = await fetch(imageUrl, { headers: { 'User-Agent': UA } });
    const type = (res.headers.get('Content-Type') || '').split(';')[0].trim();
    const ext = IMG_EXT[type];
    const size = Number(res.headers.get('Content-Length') || 0);
    if (!res.ok || !ext || size > MAX_IMAGE) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_IMAGE) return null;
    const key = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
    await env.MEDIA.put(key, buf, { httpMetadata: { contentType: type } });
    return key;
  } catch {
    return null;
  }
}

function clean(input) {
  const title = String(input.title || '').trim().slice(0, 200);
  if (!title) throw new Error('A coluna precisa de um título.');
  const published = Number(input.published_at) || parseDate(input.published_at) || Date.now();
  return {
    title,
    summary: String(input.summary || '').trim().slice(0, 400),
    source: String(input.source || 'Jornal do Brasil').trim().slice(0, 60) || 'Jornal do Brasil',
    published_at: published,
  };
}

export async function add(env, input) {
  const url = validUrl(input.url);
  const exists = await env.DB.prepare('SELECT id FROM columns WHERE url = ?').bind(url).first();
  if (exists) throw new Error('Essa coluna já está na lista.');
  const c = clean(input);
  const imageUrl = /^https?:\/\//.test(input.image_url || '') ? input.image_url : null;
  const imageKey = await copyImage(env, imageUrl);
  const now = Date.now();
  const res = await env.DB.prepare(
    `INSERT INTO columns (url, title, summary, image_key, image_url, source, published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(url, c.title, c.summary, imageKey, imageUrl, c.source, c.published_at, now, now).run();
  return env.DB.prepare('SELECT * FROM columns WHERE id = ?').bind(res.meta.last_row_id).first();
}

export async function update(env, id, input) {
  const c = clean(input);
  const r = await env.DB.prepare(
    'UPDATE columns SET title = ?, summary = ?, source = ?, published_at = ?, updated_at = ? WHERE id = ?',
  ).bind(c.title, c.summary, c.source, c.published_at, Date.now(), id).run();
  if (!r.meta.changes) return null;
  return env.DB.prepare('SELECT * FROM columns WHERE id = ?').bind(id).first();
}

export async function remove(env, id) {
  return (await env.DB.prepare('DELETE FROM columns WHERE id = ?').bind(id).run()).meta.changes > 0;
}

export async function list(env, limit = 200) {
  const { results } = await env.DB.prepare('SELECT * FROM columns ORDER BY published_at DESC LIMIT ?').bind(limit).all();
  return results;
}

export async function referencedKeys(env) {
  const { results } = await env.DB.prepare('SELECT image_key FROM columns WHERE image_key IS NOT NULL').all();
  return new Set(results.map((r) => r.image_key));
}
