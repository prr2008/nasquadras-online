// Podcast (A Temporada, no Spotify): os episódios vêm do feed RSS do Spotify
// for Creators (Anchor). A rotina confere o feed a cada hora, grava os
// episódios no D1 e divulga sozinha os episódios NOVOS (os que já estavam no
// feed na primeira leitura entram como já divulgados).

import { sanitizeHtml, slugify } from './blog.js';
import { compose, getMentions } from './compose.js';
import * as threads from './threads.js';
import * as bluesky from './bluesky.js';
import * as mastodon from './mastodon.js';
import * as buffer from './buffer.js';

const CHANNEL_KEY = 'podcast:channel';
const BASELINE_KEY = 'podcast:baseline';
const TAGS = '#Podcast #Basquete';
const ANNOUNCE_MAX_AGE = 7 * 86400e3; // não divulga episódio antigo que reapareça no feed

export const feedUrl = (env) => env.PODCAST_FEED || '';
export const configured = (env) => /^https:\/\//.test(feedUrl(env));

// ---------- Leitura do feed ----------

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decode(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function tag(xml, name) {
  const m = xml.match(new RegExp(`<${esc(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${esc(name)}>`, 'i'));
  if (!m) return '';
  const raw = m[1].trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return cdata ? cdata[1].trim() : decode(raw);
}
function attr(xml, name, attribute) {
  const m = xml.match(new RegExp(`<${esc(name)}\\s[^>]*?${attribute}="([^"]*)"`, 'i'));
  return m ? decode(m[1]) : '';
}

/** "00:08:41", "8:41" ou "521" → segundos. */
export function parseDuration(s) {
  const v = String(s || '').trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v);
  const parts = v.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function plainSummary(html, max = 220) {
  const text = decode(String(html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<\/p>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30)).replace(/[,;:.\s]+$/, '')}…`;
}

export function parseFeed(xml) {
  const head = xml.split(/<item[\s>]/i)[0];
  const channel = {
    title: tag(head, 'title'),
    description: plainSummary(tag(head, 'description'), 600),
    author: tag(head, 'itunes:author'),
    image: attr(head, 'itunes:image', 'href') || tag(tag(head, 'image'), 'url'),
    link: tag(head, 'link'),
  };
  const items = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map(([it]) => {
    const pub = Date.parse(tag(it, 'pubDate'));
    return {
      guid: tag(it, 'guid') || attr(it, 'enclosure', 'url'),
      title: tag(it, 'title') || tag(it, 'itunes:title'),
      description: tag(it, 'description') || tag(it, 'content:encoded') || tag(it, 'itunes:summary'),
      audio_url: attr(it, 'enclosure', 'url'),
      audio_type: attr(it, 'enclosure', 'type') || 'audio/mpeg',
      duration_s: parseDuration(tag(it, 'itunes:duration')),
      image_url: attr(it, 'itunes:image', 'href') || null,
      season: Number(tag(it, 'itunes:season')) || null,
      episode: Number(tag(it, 'itunes:episode')) || null,
      link: tag(it, 'link') || null,
      published_at: Number.isFinite(pub) ? pub : null,
    };
  }).filter((e) => e.guid && e.title && e.audio_url);
  return { channel, items };
}

async function uniqueSlug(env, base) {
  const root = (base || 'episodio').slice(0, 80);
  for (let n = 1; n < 50; n++) {
    const slug = n === 1 ? root : `${root}-${n}`;
    if (!(await env.DB.prepare('SELECT id FROM podcast_episodes WHERE slug = ?').bind(slug).first())) return slug;
  }
  return `${root}-${Date.now()}`;
}

/**
 * Lê o feed e grava os episódios. Na primeira vez, todos entram como já
 * divulgados (não divulga o que já existia); depois, cada novo entra pendente.
 */
export async function sync(env, { now = Date.now(), sanitize = sanitizeHtml } = {}) {
  if (!configured(env)) throw new Error('Podcast não configurado: falta PODCAST_FEED.');
  const res = await fetch(feedUrl(env), { headers: { 'User-Agent': 'NasQuadrasOnline/1.0 (+https://nasquadras.online)' } });
  if (!res.ok) throw new Error(`Feed do podcast: HTTP ${res.status}`);
  const { channel, items } = parseFeed(await res.text());
  if (!items.length) throw new Error('O feed do podcast veio sem episódios.');
  await env.KV.put(CHANNEL_KEY, JSON.stringify({ ...channel, checkedAt: now }));
  const firstRun = !(await env.KV.get(BASELINE_KEY));
  const added = [];
  for (const it of [...items].reverse()) { // do mais antigo para o mais novo
    const description = await sanitize(it.description || '');
    const summary = plainSummary(it.description);
    const cur = await env.DB.prepare('SELECT id FROM podcast_episodes WHERE guid = ?').bind(it.guid).first();
    if (cur) {
      await env.DB.prepare(
        `UPDATE podcast_episodes SET title = ?, description_html = ?, summary = ?, audio_url = ?, audio_type = ?, duration_s = ?,
         image_url = ?, season = ?, episode = ?, link = ?, published_at = COALESCE(?, published_at), updated_at = ?
         WHERE id = ? AND (title != ? OR audio_url != ? OR description_html != ? OR IFNULL(image_url,'') != IFNULL(?,''))`,
      ).bind(it.title, description, summary, it.audio_url, it.audio_type, it.duration_s, it.image_url, it.season, it.episode,
        it.link, it.published_at, now, cur.id, it.title, it.audio_url, description, it.image_url).run();
      continue;
    }
    const slug = await uniqueSlug(env, slugify(it.title));
    await env.DB.prepare(
      `INSERT INTO podcast_episodes (guid, slug, title, description_html, summary, audio_url, audio_type, duration_s, image_url,
       season, episode, link, published_at, hidden, announced, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    ).bind(it.guid, slug, it.title, description, summary, it.audio_url, it.audio_type, it.duration_s, it.image_url,
      it.season, it.episode, it.link, it.published_at || now, firstRun ? 1 : 0, now, now).run();
    added.push({ title: it.title, slug });
  }
  if (firstRun) await env.KV.put(BASELINE_KEY, String(now));
  return { total: items.length, added, firstRun };
}

// ---------- Consultas ----------

export async function getChannel(env) {
  return JSON.parse((await env.KV.get(CHANNEL_KEY)) || 'null');
}

export async function list(env, { limit = 500, includeHidden = false } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM podcast_episodes ${includeHidden ? '' : 'WHERE hidden = 0'} ORDER BY published_at DESC, id DESC LIMIT ?`,
  ).bind(limit).all();
  return results;
}

export async function getBySlug(env, slug) {
  return env.DB.prepare('SELECT * FROM podcast_episodes WHERE slug = ? AND hidden = 0').bind(slug).first();
}

export async function setHidden(env, id, hidden) {
  await env.DB.prepare('UPDATE podcast_episodes SET hidden = ?, updated_at = ? WHERE id = ?').bind(hidden ? 1 : 0, Date.now(), id).run();
  return env.DB.prepare('SELECT * FROM podcast_episodes WHERE id = ?').bind(id).first();
}

export function episodeTag(e) {
  return [e.season ? `T${e.season}` : '', e.episode ? `Ep. ${e.episode}` : ''].filter(Boolean).join(' · ');
}

export function fmtDuration(s) {
  if (!s) return '';
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

// ---------- Divulgação ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function threadsText(env, text, topicTag) {
  const { containerId } = await threads.createContainers(env, { text, topicTag });
  for (let i = 0; i < 10; i++) {
    const [s] = await threads.containerStatus(env, [containerId]);
    if (s?.status === 'FINISHED') break;
    if (s?.status === 'ERROR') throw new Error(s.error || 'erro no Threads');
    await sleep(1500);
  }
  return threads.publish(env, containerId);
}

export function announceText(e, siteUrl, channel) {
  const name = channel?.title ? channel.title.replace(/\s+com Pedro Rodrigues$/i, '') : 'podcast';
  const link = `${siteUrl}/podcast/${e.slug}`;
  const tagLine = episodeTag(e);
  const summary = plainSummary(e.summary, 160);
  return {
    long: `🎙️ Episódio novo do ${name}: ${e.title}${tagLine ? ` (${tagLine})` : ''}\n\n${summary ? `${summary}\n\n` : ''}${link}`,
    short: `🎙️ Episódio novo do ${name}: ${e.title}\n\n${link}`,
  };
}

/** Publica o post do episódio no Threads, Bluesky, Mastodon e X (o que estiver conectado). */
export async function announce(env, e, siteUrl) {
  const channel = await getChannel(env);
  const t = announceText(e, siteUrl, channel);
  const mentions = await getMentions(env);
  const jobs = {};
  const th = compose({ network: 'threads', text: t.long, tags: TAGS, mentions });
  jobs.threads = threadsText(env, th.text, th.topic).then((r) => r.url || 'ok');
  jobs.bluesky = bluesky.post(env, { text: compose({ network: 'bluesky', text: t.long, tags: TAGS, mentions }).text }).then((r) => r.url);
  if (mastodon.configured(env)) {
    jobs.mastodon = mastodon.post(env, { text: compose({ network: 'mastodon', text: t.long, tags: TAGS, mentions }).text }).then((r) => r.url);
  }
  if (buffer.configured(env)) {
    jobs.x = buffer.postNow(env, { text: compose({ network: 'x', text: t.short, tags: TAGS, mentions }).text }).then(() => 'ok');
  }
  const names = Object.keys(jobs);
  const settled = await Promise.allSettled(Object.values(jobs));
  const result = {};
  names.forEach((n, i) => { result[n] = settled[i].status === 'fulfilled' ? settled[i].value : { error: settled[i].reason?.message || 'erro' }; });
  return result;
}

/** Divulga o episódio novo pendente (um por vez, só se recente). */
export async function announcePending(env, siteUrl, now = Date.now()) {
  const e = await env.DB.prepare(
    'SELECT * FROM podcast_episodes WHERE announced = 0 AND hidden = 0 ORDER BY published_at ASC, id ASC LIMIT 1',
  ).first();
  if (!e) return null;
  // Marca antes de postar: uma falha não vira post repetido a cada hora.
  await env.DB.prepare('UPDATE podcast_episodes SET announced = 1, updated_at = ? WHERE id = ?').bind(now, e.id).run();
  if (now - (e.published_at || now) > ANNOUNCE_MAX_AGE) return { skipped: e.slug };
  const result = await announce(env, e, siteUrl);
  await env.DB.prepare('UPDATE podcast_episodes SET announce_result = ? WHERE id = ?').bind(JSON.stringify(result), e.id).run();
  return { slug: e.slug, result };
}
