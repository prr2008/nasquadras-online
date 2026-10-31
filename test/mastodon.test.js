import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as mastodon from '../src/mastodon.js';
import { compose } from '../src/compose.js';

const memKV = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v), m }; };

function mock(handler) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, method: init.method || 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body, headers: init.headers });
    const [status, json] = handler(u, init);
    return new Response(JSON.stringify(json), { status });
  };
  return calls;
}

test('1º post público, resposta no fio "não listada", fotos como anexo', async () => {
  const env = { MASTODON_TOKEN: 'tok123456', KV: memKV(), MEDIA: { get: async () => ({ arrayBuffer: async () => new ArrayBuffer(8), httpMetadata: { contentType: 'image/jpeg' } }) } };
  let n = 0;
  const calls = mock((u) => {
    if (u.pathname === '/api/v2/media') return [200, { id: `m${++n}`, url: 'https://x/img.jpg' }];
    if (u.pathname === '/api/v1/statuses') return [200, { id: `s${++n}`, url: `https://mastodon.social/@prr2008/s${n}` }];
    return [404, { error: 'não simulado' }];
  });
  const r1 = await mastodon.post(env, { text: 'Abre o fio', media: [{ key: 'k1', kind: 'image', alt: 'Quadra' }] });
  const s1 = calls.find((c) => c.path === '/api/v1/statuses').body;
  assert.equal(s1.visibility, 'public');
  assert.deepEqual(s1.media_ids, ['m1']);
  assert.equal(s1.in_reply_to_id, undefined);
  assert.ok(calls[0].headers.Authorization === 'Bearer tok123456');
  calls.length = 0;
  await mastodon.post(env, { text: 'Resposta', replyToId: r1.lastId });
  const s2 = calls.find((c) => c.path === '/api/v1/statuses').body;
  assert.equal(s2.visibility, 'unlisted');
  assert.equal(s2.in_reply_to_id, r1.lastId);
});

test('texto acima de 500 vira fio numerado', async () => {
  const env = { MASTODON_TOKEN: 't', KV: memKV() };
  let n = 0;
  const calls = mock(() => [200, { id: `s${++n}`, url: `https://m/${n}` }]);
  const r = await mastodon.post(env, { text: 'palavra '.repeat(120) });
  assert.equal(r.parts, 2);
  assert.equal(calls[1].body.in_reply_to_id, 's1');
  assert.equal(r.lastId, 's2');
});

test('só 4 fotos, ou só o vídeo', () => {
  const imgs = Array.from({ length: 6 }, (_, i) => ({ key: `i${i}`, kind: 'image' }));
  assert.equal(mastodon.pickMedia(imgs).length, 4);
  assert.deepEqual(mastodon.pickMedia([...imgs, { key: 'v', kind: 'video' }]).map((m) => m.key), ['v']);
});

test('hashtags e menções no Mastodon', () => {
  const mentions = [{ key: 'nbb', name: 'NBB', mastodon: 'nbb@mastodon.social' }, { key: 'lnb', name: 'LNB' }];
  const mid = compose({ network: 'mastodon', text: 'Cesta! @nbb @lnb', tags: '#NBB', inThread: true, mentions });
  assert.equal(mid.text, 'Cesta! @nbb@mastodon.social LNB');
  const first = compose({ network: 'mastodon', text: 'Abre', tags: '#NBB', inThread: true, threadFirst: true });
  assert.ok(first.text.endsWith('#NBB'));
});
