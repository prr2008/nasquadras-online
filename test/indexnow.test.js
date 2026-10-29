import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedUrls, keyFile, run } from '../src/indexnow.js';

const KEY = 'c5ad33bc921b529e423874d4e2b8514d';
const fakeDB = (rows) => ({
  prepare: (sql) => ({
    bind: () => ({
      all: async () => ({
        results: /FROM articles/.test(sql) ? rows.articles
          : /FROM games/.test(sql) ? rows.games
          : /FROM columns/.test(sql) ? rows.columns
          : /FROM episodes/.test(sql) ? rows.episodes
          : rows.pages,
      }),
    }),
  }),
});
const kv = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; };

test('arquivo da chave só no caminho certo', () => {
  const env = { INDEXNOW_KEY: KEY };
  assert.equal(keyFile(env, `/${KEY}.txt`), KEY);
  assert.equal(keyFile(env, '/outra.txt'), null);
  assert.equal(keyFile({}, `/${KEY}.txt`), null);
});

test('monta os endereços do que mudou', async () => {
  const env = { DB: fakeDB({ articles: [{ slug: 'texto' }], games: [{ slug: 'a-x-b' }], columns: [], episodes: [{ id: 1 }], pages: [{ slug: 'sobre' }, { slug: 'x' }] }) };
  const urls = await changedUrls(env, 'https://nasquadras.online', 100);
  assert.deepEqual(urls.sort(), [
    'https://nasquadras.online/', 'https://nasquadras.online/blog', 'https://nasquadras.online/blog/texto',
    'https://nasquadras.online/c', 'https://nasquadras.online/c/a-x-b', 'https://nasquadras.online/sobre',
    'https://nasquadras.online/zona-de-conforto',
  ].sort());
});

test('sem mudanças não chama a API nem grava', async () => {
  const env = { INDEXNOW_KEY: KEY, KV: kv(), DB: fakeDB({ articles: [], games: [], columns: [], episodes: [], pages: [] }) };
  env.KV.m.set('indexnow:since', '5');
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response('', { status: 200 }); };
  const r = await run(env, 'https://nasquadras.online', 10);
  assert.equal(r.sent, 0);
  assert.equal(called, false);
  assert.equal(env.KV.m.get('indexnow:since'), '5');
});

test('envia e guarda o marco', async () => {
  const env = { INDEXNOW_KEY: KEY, KV: kv(), DB: fakeDB({ articles: [{ slug: 't' }], games: [], columns: [], episodes: [], pages: [] }) };
  let body;
  globalThis.fetch = async (url, init) => { body = JSON.parse(init.body); return new Response('', { status: 202 }); };
  const r = await run(env, 'https://nasquadras.online', 42);
  assert.equal(body.host, 'nasquadras.online');
  assert.equal(body.keyLocation, `https://nasquadras.online/${KEY}.txt`);
  assert.ok(body.urlList.includes('https://nasquadras.online/blog/t'));
  assert.ok(r.sent > 0);
  assert.equal(env.KV.m.get('indexnow:since'), '42');
});

test('recusa pausa as próximas tentativas', async () => {
  const env = { INDEXNOW_KEY: KEY, KV: kv(), DB: fakeDB({ articles: [{ slug: 't' }], games: [], columns: [], episodes: [], pages: [] }) };
  globalThis.fetch = async () => new Response('{}', { status: 429 });
  await assert.rejects(() => run(env, 'https://nasquadras.online', 1), /429/);
  assert.ok(env.KV.m.get('indexnow:pause'));
  const r = await run(env, 'https://nasquadras.online', 2);
  assert.equal(r.paused, true);
});
