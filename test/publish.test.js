// Testa a lógica de publicação com as APIs simuladas (sem rede).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as threads from '../src/threads.js';
import * as bluesky from '../src/bluesky.js';

// FixedLengthStream existe nos Workers, não no Node.
globalThis.FixedLengthStream ??= class extends TransformStream { constructor() { super(); } };

const memKV = () => {
  const m = new Map();
  return { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v), delete: async (k) => void m.delete(k), m };
};
const memR2 = (files) => ({
  get: async (key) => (files[key] ? {
    size: files[key].length,
    body: new Blob([files[key]]).stream(),
    httpMetadata: { contentType: key.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg' },
  } : null),
});

let calls;
function mockFetch(handler) {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body)
      : typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ method: init.method || 'GET', path: u.pathname, query: Object.fromEntries(u.searchParams), body, headers: init.headers || {} });
    if (body instanceof ReadableStream) await new Response(body).arrayBuffer(); // consome o upload
    const out = handler(u, body, init);
    return new Response(JSON.stringify(out.json ?? {}), { status: out.status ?? 200 });
  };
}

let env;
beforeEach(() => {
  env = {
    THREADS_APP_ID: '123', THREADS_APP_SECRET: 's',
    BLUESKY_HANDLE: 'pedro.bsky.social', BLUESKY_APP_PASSWORD: 'app-pass',
    KV: memKV(),
    MEDIA: memR2({ 'a.jpg': new Uint8Array(10), 'b.jpg': new Uint8Array(20), 'v.mp4': new Uint8Array(50) }),
  };
});

test('Threads: OAuth troca código por token longo e guarda no KV', async () => {
  mockFetch((u) => {
    if (u.pathname === '/oauth/access_token') return { json: { access_token: 'short', user_id: 99 } };
    if (u.pathname === '/access_token') return { json: { access_token: 'long', expires_in: 5184000 } };
    if (u.pathname === '/v1.0/me') return { json: { id: '99', username: 'pedro' } };
    return { status: 404 };
  });
  const auth = await threads.handleCallback(env, 'https://app.example', 'CODE');
  assert.equal(auth.token, 'long');
  assert.equal(auth.username, 'pedro');
  assert.equal(calls[0].body.redirect_uri, 'https://app.example/auth/threads/callback');
  assert.equal(calls[1].query.grant_type, 'th_exchange_token');
  assert.ok(JSON.parse(env.KV.m.get('threads:auth')).expiresAt > Date.now());
});

test('Threads: post com 1 foto cria contêiner IMAGE com texto', async () => {
  env.KV.m.set('threads:auth', JSON.stringify({ token: 'T', userId: '99', expiresAt: Date.now() + 1e9, refreshedAt: Date.now() }));
  mockFetch(() => ({ json: { id: 'C1' } }));
  const r = await threads.createContainers(env, { text: 'Oi', media: [{ kind: 'image', url: 'https://x/m/a.jpg', alt: 'foto' }] });
  assert.deepEqual(r, { containerId: 'C1', itemIds: [] });
  assert.equal(calls[0].path, '/v1.0/99/threads');
  assert.equal(calls[0].body.media_type, 'IMAGE');
  assert.equal(calls[0].body.image_url, 'https://x/m/a.jpg');
  assert.equal(calls[0].body.text, 'Oi');
});

test('Threads: carrossel cria itens, depois o contêiner CAROUSEL, e publica com link', async () => {
  env.KV.m.set('threads:auth', JSON.stringify({ token: 'T', userId: '99', expiresAt: Date.now() + 1e9, refreshedAt: Date.now() }));
  let n = 0;
  mockFetch((u, body) => {
    if (u.pathname.endsWith('/threads_publish')) return { json: { id: 'POST1' } };
    if (u.pathname === '/v1.0/POST1') return { json: { permalink: 'https://www.threads.net/@pedro/post/abc' } };
    if (body?.media_type === 'CAROUSEL') return { json: { id: 'CAR' } };
    return { json: { id: `I${++n}` } };
  });
  const media = [{ kind: 'image', url: 'u1' }, { kind: 'video', url: 'u2' }];
  const r = await threads.createContainers(env, { text: 'Fotos', media });
  assert.deepEqual(r.itemIds, ['I1', 'I2']);
  assert.equal(calls[0].body.is_carousel_item, 'true');
  assert.equal(calls[1].body.media_type, 'VIDEO');
  assert.equal(calls[0].body.text, undefined, 'itens do carrossel não levam texto');
  const c = await threads.createCarousel(env, { text: 'Fotos', itemIds: r.itemIds });
  assert.equal(c.containerId, 'CAR');
  assert.equal(calls.at(-1).body.children, 'I1,I2');
  const p = await threads.publish(env, 'CAR');
  assert.equal(p.url, 'https://www.threads.net/@pedro/post/abc');
});

test('Threads: erro da API vira mensagem legível', async () => {
  env.KV.m.set('threads:auth', JSON.stringify({ token: 'T', userId: '99', expiresAt: Date.now() + 1e9, refreshedAt: Date.now() }));
  mockFetch(() => ({ status: 400, json: { error: { message: 'Invalid parameter' } } }));
  await assert.rejects(threads.createContainers(env, { text: 'x' }), /Threads: Invalid parameter/);
});

const session = { accessJwt: 'A', refreshJwt: 'R', did: 'did:plc:pedro', handle: 'pedro.bsky.social',
  didDoc: { service: [{ id: '#atproto_pds', serviceEndpoint: 'https://pds.example' }] } };

test('Bluesky: login, upload de 2 fotos e post com facets', async () => {
  mockFetch((u) => {
    if (u.pathname.endsWith('createSession')) return { json: session };
    if (u.pathname.endsWith('uploadBlob')) return { json: { blob: { $type: 'blob', ref: { $link: 'x' }, size: 10 } } };
    if (u.pathname.endsWith('createRecord')) return { json: { uri: 'at://did:plc:pedro/app.bsky.feed.post/3abc', cid: 'c1' } };
    return { status: 404 };
  });
  const media = [{ key: 'a.jpg', kind: 'image', width: 100, height: 50, alt: 'a' }, { key: 'b.jpg', kind: 'image' }];
  const r = await bluesky.post(env, { text: 'Final! #NBA', media });
  assert.equal(r.url, 'https://bsky.app/profile/pedro.bsky.social/post/3abc');
  assert.equal(calls[0].body.identifier, 'pedro.bsky.social');
  assert.equal(calls[1].path, '/xrpc/com.atproto.repo.uploadBlob');
  assert.ok(calls[1].headers.Authorization === 'Bearer A');
  const rec = calls.at(-1).body.record;
  assert.equal(rec.embed.$type, 'app.bsky.embed.images');
  assert.equal(rec.embed.images.length, 2);
  assert.deepEqual(rec.embed.images[0].aspectRatio, { width: 100, height: 50 });
  assert.equal(rec.facets[0].features[0].tag, 'NBA');
  assert.deepEqual(rec.langs, ['pt']);
});

test('Bluesky: texto longo vira fio com reply encadeado; vídeo vai no primeiro', async () => {
  env.KV.m.set('bsky:session', JSON.stringify({ ...session, pds: 'https://pds.example' }));
  let i = 0;
  mockFetch((u) => {
    if (u.pathname.endsWith('uploadBlob')) return { json: { blob: { $type: 'blob' } } };
    i++;
    return { json: { uri: `at://did/app.bsky.feed.post/p${i}`, cid: `c${i}` } };
  });
  const r = await bluesky.post(env, { text: 'palavra '.repeat(80), media: [{ key: 'v.mp4', kind: 'video' }, { key: 'a.jpg', kind: 'image' }] });
  const recs = calls.filter((c) => c.path.endsWith('createRecord')).map((c) => c.body.record);
  assert.equal(recs.length, r.parts);
  assert.ok(r.parts >= 2);
  assert.equal(recs[0].embed.$type, 'app.bsky.embed.video');
  assert.equal(recs[1].embed, undefined);
  assert.deepEqual(recs[1].reply.root, { uri: 'at://did/app.bsky.feed.post/p1', cid: 'c1' });
  assert.ok(r.note, 'avisa que a foto ficou de fora');
  assert.equal(calls.filter((c) => c.path.endsWith('uploadBlob')).length, 1);
});

test('Bluesky: sessão expirada é renovada e a chamada repetida', async () => {
  env.KV.m.set('bsky:session', JSON.stringify({ ...session, pds: 'https://pds.example' }));
  let first = true;
  mockFetch((u) => {
    if (u.pathname.endsWith('refreshSession')) return { json: { ...session, accessJwt: 'A2' } };
    if (u.pathname.endsWith('createRecord')) {
      if (first) { first = false; return { status: 400, json: { error: 'ExpiredToken', message: 'Token has expired' } }; }
      return { json: { uri: 'at://did/app.bsky.feed.post/ok', cid: 'c' } };
    }
    return { status: 404 };
  });
  const r = await bluesky.post(env, { text: 'oi' });
  assert.ok(r.url.endsWith('/ok'));
  assert.equal(calls.at(-1).headers.Authorization, 'Bearer A2');
});

// ---------- Fio da cobertura ----------
import * as coverage from '../src/coverage.js';

test('Threads: resposta no fio envia reply_to_id', async () => {
  env.KV.m.set('threads:auth', JSON.stringify({ token: 'T', userId: '99', expiresAt: Date.now() + 1e9, refreshedAt: Date.now() }));
  mockFetch(() => ({ json: { id: 'C9' } }));
  await threads.createContainers(env, { text: 'Lance', replyToId: 'POST1' });
  assert.equal(calls[0].body.reply_to_id, 'POST1');
  await threads.createContainers(env, { text: 'Solto' });
  assert.equal(calls[1].body.reply_to_id, undefined, 'post solto não leva reply_to_id');
});

test('Threads: token antigo sem a permissão de respostas é detectado', () => {
  assert.equal(threads.canReply({ scopes: 'threads_basic,threads_content_publish' }), false);
  assert.equal(threads.canReply({}), false);
  assert.equal(threads.canReply({ scopes: 'threads_basic,threads_content_publish,threads_manage_replies' }), true);
});

test('Fio: primeiro post abre, os seguintes respondem ao último (Threads e Bluesky)', async () => {
  await coverage.start(env, 'Knicks x Spurs');
  assert.equal(await coverage.threadsReplyTo(env), null, 'primeiro post não responde a ninguém');
  assert.equal(await coverage.blueskyReplyTo(env), null);

  await coverage.threadsAppend(env, { id: 'T1', url: 'https://threads/t1' });
  await coverage.blueskyAppend(env, { root: { uri: 'at://b1', cid: 'c1' }, last: { uri: 'at://b1', cid: 'c1' }, rootUrl: 'https://bsky/b1', parts: 1 });
  assert.equal(await coverage.threadsReplyTo(env), 'T1');

  await coverage.threadsAppend(env, { id: 'T2', url: 'https://threads/t2' });
  await coverage.blueskyAppend(env, { root: { uri: 'at://b1', cid: 'c1' }, last: { uri: 'at://b3', cid: 'c3' }, rootUrl: 'https://bsky/b1', parts: 2 });
  assert.equal(await coverage.threadsReplyTo(env), 'T2', 'responde ao último, formando o fio');
  assert.deepEqual(await coverage.blueskyReplyTo(env), { root: { uri: 'at://b1', cid: 'c1' }, parent: { uri: 'at://b3', cid: 'c3' } });

  const st = await coverage.get(env);
  assert.equal(st.active, true);
  assert.equal(st.title, 'Knicks x Spurs');
  assert.equal(st.threads.count, 2);
  assert.equal(st.threads.rootUrl, 'https://threads/t1', 'link do fio aponta para o primeiro post');
  assert.equal(st.bluesky.count, 3);

  await coverage.stop(env);
  assert.equal(await coverage.threadsReplyTo(env), null, 'fio encerrado: posts voltam a sair soltos');
  await coverage.threadsAppend(env, { id: 'T3' });
  assert.equal((await coverage.get(env)).threads.count, 2, 'posts soltos não contam no fio');

  await coverage.start(env);
  assert.equal(await coverage.threadsReplyTo(env), null, 'novo fio começa do zero');
});

test('Bluesky: post no fio responde ao último e mantém a raiz', async () => {
  env.KV.m.set('bsky:session', JSON.stringify({ ...session, pds: 'https://pds.example' }));
  mockFetch(() => ({ json: { uri: 'at://did/app.bsky.feed.post/novo', cid: 'cn' } }));
  const replyTo = { root: { uri: 'at://did/app.bsky.feed.post/raiz', cid: 'cr' }, parent: { uri: 'at://did/app.bsky.feed.post/ult', cid: 'cu' } };
  const r = await bluesky.post(env, { text: 'Mais um lance', replyTo });
  const rec = calls.at(-1).body.record;
  assert.deepEqual(rec.reply, replyTo);
  assert.deepEqual(r.root, replyTo.root);
  assert.deepEqual(r.last, { uri: 'at://did/app.bsky.feed.post/novo', cid: 'cn' });
  assert.ok(r.url.endsWith('/novo'), 'link aponta para o post novo');
  assert.ok(r.rootUrl.endsWith('/raiz'));
});

test('Threads: erro de client_secret não expõe o segredo', async () => {
  mockFetch(() => ({ status: 400, json: { error: { message: 'Invalid client_secret: 4f00e18d1a318601b0efb195d0de7732' } } }));
  await assert.rejects(threads.handleCallback(env, 'https://app.example', 'CODE'), (err) => {
    assert.ok(!err.message.includes('4f00e18d'), 'o segredo não pode aparecer');
    assert.match(err.message, /THREADS_APP_SECRET/);
    return true;
  });
});
