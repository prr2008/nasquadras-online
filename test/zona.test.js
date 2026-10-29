import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseName, playlistId, episodeLabel } from '../src/zona.js';

const NOW = Date.parse('2026-10-29T12:00:00-03:00');
const day = (ms) => new Date(ms - 3 * 3600e3).toISOString().slice(0, 10);

test('lê número e data dos nomes das playlists', () => {
  let r = parseName('Zona de Conforto · Ep. 6 · 26/05/2026', NOW);
  assert.equal(r.number, 6); assert.equal(day(r.aired_at), '2026-05-26');
  r = parseName('Zona de Conforto - Episodio 12 -  7 de Julho de 2026', NOW);
  assert.equal(r.number, 12); assert.equal(day(r.aired_at), '2026-07-07');
  r = parseName('Zona de Conforto 11 de agosto 2026', NOW);
  assert.equal(r.number, null); assert.equal(day(r.aired_at), '2026-08-11');
  r = parseName('Zona de conforto 29 de setembro', NOW);
  assert.equal(day(r.aired_at), '2026-09-29');
  r = parseName('Zona de Conforto - 16/06/2026', NOW);
  assert.equal(day(r.aired_at), '2026-06-16');
  r = parseName('Zona de conforto agosto 2026', NOW);
  assert.equal(r.aired_at, null);
  // Sem ano e ainda no futuro: é do ano anterior.
  assert.equal(day(parseName('Zona 20 de dezembro', NOW).aired_at), '2025-12-20');
});

test('aceita os formatos de link do Spotify', () => {
  assert.equal(playlistId('https://open.spotify.com/playlist/7sMtYRefZqzz78k1rpdiZW?si=1r0gPXPxSEuvQOYrJeT-og'), '7sMtYRefZqzz78k1rpdiZW');
  assert.equal(playlistId('spotify:playlist:7sMtYRefZqzz78k1rpdiZW'), '7sMtYRefZqzz78k1rpdiZW');
  assert.equal(playlistId('https://open.spotify.com/intl-pt/playlist/7sMtYRefZqzz78k1rpdiZW'), '7sMtYRefZqzz78k1rpdiZW');
  assert.throws(() => playlistId('https://open.spotify.com/album/abc'), /playlist do Spotify/);
});

test('rótulo da edição', () => {
  assert.equal(episodeLabel({ number: 6, aired_at: Date.parse('2026-05-26T12:00:00-03:00') }), 'Ep. 6 · 26 de maio de 2026');
  assert.equal(episodeLabel({ number: null, aired_at: null, playlist_name: 'Zona de Conforto de férias' }), 'Zona de Conforto de férias');
});
