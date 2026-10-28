// Agendamento: o 1º post abre o fio, o seguinte responde nele; X vai ao Buffer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as schedule from '../src/schedule.js';
import * as buffer from '../src/buffer.js';

const memKV = () => {
  const m = new Map();
  return { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v), delete: async (k) => void m.delete(k), m };
};
// D1 falso: só registra as atualizações do status.
const fakeDB = (log) => ({
  prepare: (sql) => ({ bind: (...args) => ({ run: async () => { log.push({ sql, args }); return { meta: { changes: 1 } }; } }) }),
});

let calls = [];
function mockFetch(handler) {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body)
      : typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ host: u.host, path: u.pathname, query: Object.fromEntries(u.searchParams), body, headers: init.headers || {} });
    const out = handler(u, body);
    return new Response(JSON.stringify(out.json ?? {}), { status: out.status ?? 200 });
  };
}

const session = { accessJwt: 'A', refreshJwt: 'R', did: 'did:plc:pedro', handle: 'pedro.bsky.social',
  didDoc: { service: [{ id: '#atproto_pds', serviceEndpoint: 'https://pds.example' }] } };

test('pré-jogo abre o fio e o post seguinte responde nele (Threads e Bluesky)', async () => {
  const log = [];
  const env = {
    THREADS_APP_ID: '1', BLUESKY_HANDLE: 'pedro.bsky.social', BLUESKY_APP_PASSWORD: 'p',
    KV: memKV(), DB: fakeDB(log), MEDIA: { get: async () => null },
  };
  env.KV.m.set('threads:auth', JSON.stringify({ token: 'T', userId: '99', expiresAt: Date.now() + 1e9, scopes: ['threads_manage_replies'] }));
  let n = 0;
  mockFetch((u) => {
    if (u.host === 'graph.threads.net') {
      if (u.pathname.endsWith('/threads')) return { json: { id: `c${++n}` } };
      if (u.pathname.endsWith('/threads_publish')) return { json: { id: `p${n}` } };
      if (u.searchParams.get('fields') === 'status,error_message') return { json: { status: 'FINISHED' } };
      if (u.searchParams.get('fields') === 'permalink') return { json: { permalink: `https://threads.net/@prr2008/post/${n}` } };
    }
    if (u.pathname.endsWith('createSession')) return { json: session };
    if (u.pathname.endsWith('createRecord')) return { json: { uri: `at://did:plc:pedro/app.bsky.feed.post/r${n}`, cid: `cid${n}` } };
    return { status: 404, json: { error: `não simulado: ${u}` } };
  });

  const base = { origin: 'https://app.nasquadras.online', media: [], targets: { threads: true, bluesky: true, site: false }, lnb_id: null };
  const r1 = await schedule.publish(env, { ...base, id: 1, text: '🏀 Botafogo x Caxias, 20h', thread: 'start', title: 'Botafogo x Caxias do Sul' });
  assert.equal(r1.status, 'sent', JSON.stringify(r1.result));
  const meta = JSON.parse(env.KV.m.get('cov:meta'));
  assert.equal(meta.active, true);
  assert.equal(meta.title, 'Botafogo x Caxias do Sul');
  const first = calls.find((c) => c.path.endsWith('/threads'));
  assert.equal(first.body.reply_to_id, undefined);

  calls.length = 0;
  const r2 = await schedule.publish(env, { ...base, id: 2, text: 'Último duelo: Caxias 67x68 Botafogo', thread: 'reply', title: null });
  assert.equal(r2.status, 'sent', JSON.stringify(r2.result));
  const reply = calls.find((c) => c.path.endsWith('/threads'));
  assert.equal(reply.body.reply_to_id, 'p1');
  const bsky = calls.find((c) => c.path.endsWith('createRecord'));
  assert.equal(bsky.body.record.reply.root.uri, 'at://did:plc:pedro/app.bsky.feed.post/r1');
  assert.ok(log.some((l) => /UPDATE scheduled SET status/.test(l.sql) && l.args[0] === 'sent'));
  assert.equal(JSON.parse(env.KV.m.get('history')).length, 2);
});

test('falha numa rede vira "publicado em parte" e guarda o erro', async () => {
  const log = [];
  const env = { KV: memKV(), DB: fakeDB(log), BLUESKY_HANDLE: 'pedro.bsky.social', BLUESKY_APP_PASSWORD: 'p', MEDIA: { get: async () => null } };
  mockFetch((u) => {
    if (u.pathname.endsWith('createSession')) return { json: session };
    if (u.pathname.endsWith('createRecord')) return { json: { uri: 'at://did:plc:pedro/app.bsky.feed.post/z', cid: 'c' } };
    return { status: 404 };
  });
  const r = await schedule.publish(env, { id: 9, origin: 'https://x', media: [], text: 'oi', thread: 'none',
    targets: { threads: true, bluesky: true, site: false } });
  assert.equal(r.status, 'partial');
  assert.match(r.result.threadsError, /Threads não conectado/);
  assert.ok(r.result.bluesky);
});

test('Buffer: agenda no canal do X com horário e foto', async () => {
  const env = { BUFFER_API_KEY: 'k', BUFFER_X_CHANNEL: 'chan1' };
  mockFetch(() => ({ json: { data: { createPost: { post: { id: 'buf1', dueAt: 'x' } } } } }));
  const id = await buffer.schedulePost(env, { text: 'Botafogo x Caxias', dueAt: Date.UTC(2026, 9, 28, 22, 45), media: [{ kind: 'image', url: 'https://app/m/a.jpg' }] });
  assert.equal(id, 'buf1');
  const c = calls[0];
  assert.equal(c.host, 'api.buffer.com');
  assert.equal(c.headers.Authorization, 'Bearer k');
  assert.deepEqual(c.body.variables.input, {
    channelId: 'chan1', text: 'Botafogo x Caxias', assets: [{ image: { url: 'https://app/m/a.jpg' } }],
    schedulingType: 'automatic', mode: 'customScheduled', dueAt: '2026-10-28T22:45:00.000Z',
  });
  mockFetch(() => ({ json: { data: { createPost: { message: 'Limite de posts agendados' } } } }));
  await assert.rejects(buffer.schedulePost(env, { text: 'x', dueAt: Date.now() }), /Limite de posts agendados/);
  mockFetch(() => ({ status: 401, json: {} }));
  await assert.rejects(buffer.deletePost(env, 'buf1'), /Chave do Buffer inválida/);
});
