// Spotify: login PKCE, busca com ranking, criação da playlist (API simulada).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as spotify from '../src/spotify.js';
import { createFromList, defaultName, importPlaylists } from '../src/zona.js';

const memKV = () => {
  const m = new Map();
  return { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v), delete: async (k) => void m.delete(k), m };
};
let calls = [];
function mockFetch(handler) {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method || 'GET', host: u.host, path: u.pathname, query: Object.fromEntries(u.searchParams), body, headers: init.headers || {} });
    const out = handler(u, body, init);
    return new Response(out.status === 204 ? null : JSON.stringify(out.json ?? {}), { status: out.status ?? 200 });
  };
}
const track = (id, name, artist, album = 'Album', ms = 200000) => ({
  uri: `spotify:track:${id.padEnd(22, 'x')}`, id, name, artists: [{ name: artist }], album: { name: album, images: [{ url: 'big' }, { url: 'small' }] }, duration_ms: ms, external_urls: { spotify: `https://open.spotify.com/track/${id}` },
});
const connected = () => {
  const env = { SPOTIFY_CLIENT_ID: 'cid', KV: memKV() };
  env.KV.m.set('spotify:auth', JSON.stringify({ access: 'A', refresh: 'R', expiresAt: Date.now() + 1e6 }));
  return env;
};

test('login PKCE: URL de autorização e troca do código', async () => {
  const env = { SPOTIFY_CLIENT_ID: 'cid', KV: memKV() };
  const url = new URL(await spotify.authorizeUrl(env, 'https://app.nasquadras.online'));
  assert.equal(url.host, 'accounts.spotify.com');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://app.nasquadras.online/auth/spotify/callback');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(url.searchParams.get('scope'), /playlist-modify-public/);
  const state = url.searchParams.get('state');
  mockFetch((u) => {
    if (u.pathname === '/api/token') return { json: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 } };
    if (u.pathname === '/v1/me') return { json: { id: 'prr2008', display_name: 'Pedro Rodrigues' } };
    return { status: 404 };
  });
  const auth = await spotify.handleCallback(env, 'https://app.nasquadras.online', { code: 'C', state });
  assert.equal(auth.name, 'Pedro Rodrigues');
  assert.equal(calls[0].body.code_verifier.length > 40, true);
  assert.equal(calls[0].body.client_id, 'cid');
  await assert.rejects(spotify.handleCallback(env, 'https://x', { code: 'C', state }), /expirado/);
});

test('token vencido é renovado (e o novo refresh token guardado)', async () => {
  const env = connected();
  env.KV.m.set('spotify:auth', JSON.stringify({ access: 'old', refresh: 'R', expiresAt: 0 }));
  mockFetch((u) => (u.pathname === '/api/token' ? { json: { access_token: 'new', refresh_token: 'R2', expires_in: 3600 } } : { json: { id: 'me' } }));
  await spotify.api(env, 'GET', '/me');
  assert.equal(calls[1].headers.Authorization, 'Bearer new');
  assert.equal(JSON.parse(env.KV.m.get('spotify:auth')).refresh, 'R2');
});

test('ranking: "Música - Artista" e "Artista - Música", versões ao vivo e medley perdem pontos', () => {
  const p = spotify.parseLine('Moving - Supergrass');
  assert.ok(spotify.score({ name: 'Moving', artists: 'Supergrass', duration_ms: 200000 }, p) > 0.9);
  const q = spotify.parseLine('Supergrass - Moving');
  assert.ok(spotify.score({ name: 'Moving', artists: 'Supergrass', duration_ms: 200000 }, q) > 0.9);
  const b = spotify.parseLine('Brand New Day - Diana Ross/Nipsy Russel/Michael Jackson');
  const medley = spotify.score({ name: 'Liberation Agitato / A Brand New Day / Liberation Ballet - Medley', artists: 'Diana Ross, Michael Jackson', duration_ms: 468000 }, b);
  const single = spotify.score({ name: 'A Brand New Day', artists: 'Diana Ross, Michael Jackson', duration_ms: 260000 }, b);
  assert.ok(single > medley, `${single} > ${medley}`);
  const live = spotify.score({ name: 'Getting Better - Live', artists: 'Paul McCartney', duration_ms: 200000 }, spotify.parseLine('Getting Better - Paul McCartney'));
  const studio = spotify.score({ name: 'Getting Better', artists: 'Paul McCartney', duration_ms: 200000 }, spotify.parseLine('Getting Better - Paul McCartney'));
  assert.ok(studio > live);
  assert.deepEqual(spotify.parseLine('3. Refazenda – Gilberto Gil'), { raw: 'Refazenda – Gilberto Gil', a: 'Refazenda', b: 'Gilberto Gil' });
});

test('busca a lista e ordena as opções de cada linha', async () => {
  const env = connected();
  mockFetch((u) => {
    if (u.pathname === '/v1/search') {
      const q = u.searchParams.get('q');
      assert.equal(u.searchParams.get('market'), 'BR');
      assert.ok(Number(u.searchParams.get('limit')) <= 10);
      if (q.includes('Refazenda')) return { json: { tracks: { items: [track('b', 'Refazenda - Ao Vivo', 'Gilberto Gil'), track('c', 'Refazenda', 'Gilberto Gil')] } } };
      return { json: { tracks: { items: [] } } };
    }
    return { status: 404 };
  });
  const [r1, r2] = await spotify.matchLines(env, ['Refazenda - Gilberto Gil', 'Inexistente - Ninguém']);
  assert.equal(r1.candidates[0].name, 'Refazenda');
  assert.equal(r1.candidates[0].image, 'small');
  assert.equal(r2.candidates.length, 0);
});

test('cria a playlist pública, adiciona as faixas e publica a edição', async () => {
  const env = connected();
  const inserted = [];
  env.DB = {
    prepare: (sql) => ({
      bind: (...args) => ({
        first: async () => (sql.startsWith('SELECT id FROM episodes WHERE playlist_id') ? null : { id: 1, playlist_id: args[0] }),
        run: async () => { inserted.push({ sql, args }); return { meta: { last_row_id: 1, changes: 1 } }; },
      }),
    }),
  };
  mockFetch((u, body) => {
    if (u.pathname === '/v1/me/playlists') return { json: { id: 'P'.repeat(22), name: body.name, external_urls: { spotify: `https://open.spotify.com/playlist/${'P'.repeat(22)}` } } };
    if (u.pathname.endsWith('/items')) return { json: { snapshot_id: 's' } };
    return { status: 404 };
  });
  const aired = Date.parse('2026-05-26T12:00:00-03:00');
  await createFromList(env, spotify, { number: 6, aired_at: aired, uris: ['spotify:track:' + 'a'.repeat(22), 'bad'] }, 'https://nasquadras.online');
  assert.equal(calls[0].body.name, 'Zona de Conforto · Ep. 6 · 26/05/2026');
  assert.equal(calls[0].body.public, true);
  assert.match(calls[0].body.description, /Ep\. 6, 26\/05\/2026.*nasquadras\.online\/zona-de-conforto/);
  assert.deepEqual(calls[1].body.uris, ['spotify:track:' + 'a'.repeat(22)]);
  assert.equal(inserted[0].args[0], 'P'.repeat(22));
  assert.equal(defaultName({ number: null, aired_at: null }), 'Zona de Conforto');
});

test('importa playlist privada: torna pública e cadastra com a data do nome', async () => {
  const env = connected();
  const runs = [];
  env.DB = { prepare: (sql) => ({ bind: (...a) => ({ first: async () => (sql.startsWith('SELECT id FROM') ? null : { id: 2 }), run: async () => { runs.push(a); return { meta: { last_row_id: 2, changes: 1 } }; } }) }) };
  mockFetch((u, body, init) => (init.method === 'PUT' ? { status: 200, json: {} } : { status: 404 }));
  const res = await importPlaylists(env, spotify, [{ id: '3BzQPSdBUSQ9FIBkB9yjfm', name: 'Zona de Conforto 11 de agosto 2026', public: false, image: null }]);
  assert.equal(res[0].ok, true);
  assert.equal(calls[0].method, 'PUT');
  assert.deepEqual(calls[0].body, { public: true });
  assert.equal(new Date(runs[0][2] - 3 * 3600e3).toISOString().slice(0, 10), '2026-08-11');
});
