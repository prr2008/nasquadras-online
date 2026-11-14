import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as fiba from '../src/fiba.js';

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/fiba_${n}.json`, import.meta.url), 'utf8'));

test('jogo ao vivo (Flamengo x Brasília, Liga Sul-Americana)', () => {
  const g = fiba.normalizeGame(load('live'), 131159);
  assert.equal(g.id, 'fiba:131159');
  assert.equal(g.status, 'live');
  assert.equal(g.period, 4);
  assert.equal(g.clock, '02:07');
  assert.equal(g.home.name, 'Flamengo');
  assert.equal(g.home.short, 'FLA');
  assert.equal(g.away.short, 'BRA');
  assert.equal(g.home.score, 78);
  assert.equal(g.away.score, 80);
  assert.deepEqual(g.quarters.map((q) => `${q.home}-${q.away}`), ['20-15', '11-29', '35-21', '12-15']);
  assert.equal(g.leaders.home.reb[0].value, 16);
  assert.ok(g.leaders.away.pts[0].name.length > 3);
  assert.equal(g.quarterLeaders.period, 4);
  const last = g.plays.find((p) => p.scoring);
  assert.ok(last && /^(Bola de 3|Cesta de 2|Lance livre) de /.test(last.text));
  assert.match(last.score, /^\d+-\d+$/);
});

test('jogo encerrado e pontos por quarto vindos do lance a lance', () => {
  const g = fiba.normalizeGame(load('final'), 131161);
  assert.equal(g.status, 'final');
  assert.equal(g.home.score, 71);
  assert.equal(g.away.score, 104);
  const sumQ = g.away.players.reduce((s, p) => s + p.byQuarter.reduce((x, q) => x + q.pts, 0), 0);
  assert.equal(sumQ, 104);
});

test('link, número e códigos de situação', () => {
  assert.equal(fiba.resolveGameId('https://www.fiba.basketball/en/events/liga-sudamericana-de-baloncesto-fiba-2026/games/131159-FLA-BRA'), 'fiba:131159');
  assert.equal(fiba.resolveGameId('131162'), 'fiba:131162');
  assert.throws(() => fiba.resolveGameId('https://lnb.com.br/x'));
  assert.equal(fiba.statusOf(999), 'final');
  assert.equal(fiba.statusOf(3), 'live');
  assert.equal(fiba.statusOf(1), 'scheduled');
  assert.equal(fiba.periodNumber('OT1'), 5);
});

test('tabela de jogos: ao vivo primeiro, depois os mais próximos', async () => {
  const now = Date.parse('2026-11-14T23:00:00Z');
  const row = (id, a, b, utc, live, st) => ({ gameId: id, teamA: { shortName: a }, teamB: { shortName: b }, gameDateTimeUTC: utc, isLive: live, liveGameStatus: st, teamAScore: 1, teamBScore: 2, currentPeriod: 'Q2', chrono: '05:00' });
  globalThis.fetch = async () => new Response(JSON.stringify([
    row(1, 'X', 'Y', '2026-10-02T21:10:00', false, 999),
    row(2, 'BOC', 'FLA', '2026-11-15T21:10:00', false, 1),
    row(3, 'FLA', 'BRA', '2026-11-14T21:10:00', true, 3),
  ]));
  const list = await fiba.listGames('lsa', now);
  assert.deepEqual(list.map((g) => g.id), ['fiba:3', 'fiba:2']);
  assert.equal(list[0].label, '2º quarto');
});
