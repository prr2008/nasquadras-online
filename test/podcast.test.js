import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as podcast from '../src/podcast.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  const ddl = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  const start = ddl.indexOf('CREATE TABLE IF NOT EXISTS podcast_episodes');
  db.exec(ddl.slice(start, ddl.indexOf(');', start) + 2));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return { prepare: (sql) => stmt(sql), raw: db };
}
// No Node não há HTMLRewriter: limpeza simples só para o teste.
const sanitize = async (h) => h.replace(/<script[\s\S]*?<\/script>/gi, '');
const memKV = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v), m }; };

const item = (n, date, extra = '') => `<item><title><![CDATA[Episódio ${n}: Flamengo & Caxias]]></title>
<description><![CDATA[<p>Conversa sobre o <strong>NBB</strong> com convidado ${n}.</p><script>x()</script>]]></description>
<link>https://podcasters.spotify.com/pod/show/prr2008/episodes/ep${n}</link>
<guid isPermaLink="false">guid-${n}</guid><pubDate>${date}</pubDate>
<enclosure url="https://anchor.fm/s/23013e20/podcast/play/${n}/a.mp3" length="1" type="audio/mpeg"/>
<itunes:duration>00:08:41</itunes:duration>${extra}</item>`;
const feed = (items) => `<?xml version="1.0"?><rss><channel><title><![CDATA[A Temporada com Pedro Rodrigues]]></title>
<description><![CDATA[Podcast de basquete.]]></description><link>https://podcasters.spotify.com/pod/show/prr2008</link>
<itunes:image href="https://img/show.jpg"/>${items.join('')}</channel></rss>`;

test('lê o feed do Anchor', () => {
  const { channel, items } = podcast.parseFeed(feed([item(1, 'Fri, 24 Apr 2026 19:07:16 GMT', '<itunes:season>5</itunes:season><itunes:episode>3</itunes:episode>')]));
  assert.equal(channel.title, 'A Temporada com Pedro Rodrigues');
  assert.equal(channel.image, 'https://img/show.jpg');
  assert.equal(items[0].title, 'Episódio 1: Flamengo & Caxias');
  assert.equal(items[0].duration_s, 521);
  assert.equal(items[0].season, 5);
  assert.equal(items[0].episode, 3);
  assert.match(items[0].audio_url, /play\/1\/a\.mp3$/);
  assert.equal(podcast.parseDuration('1:00:07'), 3607);
});

test('1ª leitura não divulga; episódio novo depois é divulgado uma vez só', async () => {
  const env = { PODCAST_FEED: 'https://anchor.fm/x/rss', DB: d1(), KV: memKV(), MEDIA: {} };
  let xml = feed([item(2, 'Sat, 07 Nov 2026 16:07:32 GMT'), item(1, 'Fri, 24 Apr 2026 19:07:16 GMT')]);
  const posted = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('anchor.fm/x/rss')) return new Response(xml);
    posted.push(new URL(u).hostname);
    return new Response(JSON.stringify({ id: '1', status: 'FINISHED', url: 'u' }), { status: 200 });
  };
  const first = await podcast.sync(env, { sanitize });
  assert.equal(first.firstRun, true);
  assert.equal(first.added.length, 2);
  assert.equal(await podcast.announcePending(env, 'https://nasquadras.online'), null);
  const ep = (await podcast.list(env))[0];
  assert.equal(ep.title, 'Episódio 2: Flamengo & Caxias');
  assert.ok(!ep.description_html.includes('<script'));
  assert.equal(ep.slug, 'episodio-2-flamengo-caxias');

  xml = feed([item(3, new Date().toUTCString()), item(2, 'Sat, 07 Nov 2026 16:07:32 GMT'), item(1, 'Fri, 24 Apr 2026 19:07:16 GMT')]);
  const again = await podcast.sync(env, { sanitize });
  assert.equal(again.added.length, 1);
  const pending = await env.DB.prepare('SELECT announced FROM podcast_episodes WHERE guid = ?').bind('guid-3').first();
  assert.equal(pending.announced, 0);
  const t = podcast.announceText({ title: 'Ep 3', slug: 'ep-3', summary: 'Resumo.' }, 'https://nasquadras.online', { title: 'A Temporada com Pedro Rodrigues' });
  assert.match(t.long, /Episódio novo do A Temporada: Ep 3/);
  assert.match(t.long, /https:\/\/nasquadras\.online\/podcast\/ep-3$/);
  // Marca como divulgado antes de postar (as redes estão simuladas e podem falhar).
  await podcast.announcePending(env, 'https://nasquadras.online').catch(() => {});
  assert.equal(await podcast.announcePending(env, 'https://nasquadras.online'), null);
});
