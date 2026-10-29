// Zona de Conforto: edições do programa, cada uma com a playlist do Spotify.
// No app, cola-se o link da playlist; o nome, a capa, o número e a data da
// edição são lidos do Spotify (oEmbed) e revisados antes de salvar.

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Aceita link do app ou da web (open.spotify.com/playlist/ID, spotify:playlist:ID, /intl-pt/…). */
export function playlistId(input) {
  const s = String(input || '').trim();
  const m = s.match(/(?:open\.spotify\.com\/(?:intl-[a-z]+\/)?(?:embed\/)?playlist\/|spotify:playlist:)([A-Za-z0-9]{22})/);
  if (!m) throw new Error('Cole o link de uma playlist do Spotify (open.spotify.com/playlist/…).');
  return m[1];
}

const at = (y, mo, d) => Date.parse(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T12:00:00-03:00`);

/** Sem ano no nome: a data mais recente que já passou (o programa já foi ao ar). */
function guessYear(mo, d, now) {
  const y = new Date(now).getUTCFullYear();
  return at(y, mo, d) <= now + 86400e3 ? y : y - 1;
}

/**
 * Lê número e data do nome da playlist. Exemplos:
 * "Zona de Conforto · Ep. 6 · 26/05/2026", "Zona de Conforto - Episodio 12 - 7 de Julho de 2026",
 * "Zona de Conforto 11 de agosto 2026", "Zona de conforto 29 de setembro".
 */
export function parseName(name, now = Date.now()) {
  const s = String(name || '');
  const num = s.match(/\b(?:ep(?:is[oó]dio)?|edi[cç][aã]o|programa)\.?\s*n?º?\s*(\d{1,4})\b/i);
  let aired = null;
  const dmy = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  const words = s.match(new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${MONTHS.join('|')})(?:\\s+(?:de\\s+)?(\\d{4}))?`, 'i'));
  if (dmy) {
    const [, d, mo, y] = dmy.map(Number);
    const year = y ? (y < 100 ? 2000 + y : y) : guessYear(mo, d, now);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) aired = at(year, mo, d);
  } else if (words) {
    const d = Number(words[1]);
    const mo = MONTHS.indexOf(words[2].toLowerCase()) + 1;
    aired = at(words[3] ? Number(words[3]) : guessYear(mo, d, now), mo, d);
  }
  return { number: num ? Number(num[1]) : null, aired_at: Number.isFinite(aired) ? aired : null };
}

/** Busca nome e capa da playlist no Spotify (só funciona com playlist pública). */
export async function fetchPreview(input) {
  const id = playlistId(input);
  const url = `https://open.spotify.com/playlist/${id}`;
  let name = '';
  let image = null;
  let isPublic = false;
  try {
    const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NasQuadrasOnline/1.0; +https://nasquadras.online)' },
    });
    if (res.ok) {
      const o = await res.json();
      name = String(o.title || '').trim();
      image = o.thumbnail_url || null;
      isPublic = true;
    }
  } catch { /* segue sem os dados do Spotify */ }
  return { playlist_id: id, playlist_url: url, playlist_name: name, image_url: image, public: isPublic, ...parseName(name) };
}

function clean(input) {
  const number = Number.parseInt(input.number, 10);
  const aired = Number(input.aired_at);
  return {
    number: Number.isFinite(number) && number > 0 ? number : null,
    aired_at: Number.isFinite(aired) && aired > 0 ? aired : null,
    title: String(input.title || '').trim().slice(0, 140),
    summary: String(input.summary || '').trim().slice(0, 600),
    playlist_name: String(input.playlist_name || '').trim().slice(0, 200),
    image_url: /^https:\/\//.test(input.image_url || '') ? input.image_url : null,
  };
}

export async function add(env, input) {
  const id = playlistId(input.playlist_url || input.playlist_id);
  const exists = await env.DB.prepare('SELECT id FROM episodes WHERE playlist_id = ?').bind(id).first();
  if (exists) throw new Error('Essa playlist já está na lista de edições.');
  const c = clean(input);
  const now = Date.now();
  const res = await env.DB.prepare(
    `INSERT INTO episodes (playlist_id, number, aired_at, title, summary, playlist_name, image_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, c.number, c.aired_at, c.title, c.summary, c.playlist_name, c.image_url, now, now).run();
  return get(env, res.meta.last_row_id);
}

export async function update(env, id, input) {
  const c = clean(input);
  const r = await env.DB.prepare(
    'UPDATE episodes SET number = ?, aired_at = ?, title = ?, summary = ?, updated_at = ? WHERE id = ?',
  ).bind(c.number, c.aired_at, c.title, c.summary, Date.now(), id).run();
  return r.meta.changes ? get(env, id) : null;
}

export async function remove(env, id) {
  return (await env.DB.prepare('DELETE FROM episodes WHERE id = ?').bind(id).run()).meta.changes > 0;
}

export async function get(env, id) {
  return env.DB.prepare('SELECT * FROM episodes WHERE id = ?').bind(id).first();
}

/** Mais recentes primeiro (pela data; sem data, pelo número e pela ordem de cadastro). */
export async function list(env, limit = 300) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM episodes ORDER BY COALESCE(aired_at, 0) DESC, COALESCE(number, 0) DESC, created_at DESC LIMIT ?`,
  ).bind(limit).all();
  return results;
}

const DATE_FMT = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });

/** "Ep. 6 · 26 de maio de 2026" (ou só a data, ou só o número). */
export function episodeLabel(e) {
  return [e.number ? `Ep. ${e.number}` : '', e.aired_at ? DATE_FMT.format(e.aired_at) : ''].filter(Boolean).join(' · ')
    || e.playlist_name || 'Edição';
}
