// Resumo da noite anterior: datas, leitura da ESPN, captura do NBB e o texto falado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as briefing from '../src/briefing.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  const ddl = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  db.exec(ddl.slice(ddl.indexOf('CREATE TABLE IF NOT EXISTS nbb_results')));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { db.prepare(sql).run(...args); return {}; },
  });
  return { prepare: (sql) => stmt(sql) };
}

// Formato da ESPN (rodada de 14/11/2026), resumido.
const team = (location, short, display) => ({ location, shortDisplayName: short, displayName: display });
const espn = {
  events: [
    {
      status: { type: { completed: true, state: 'post', shortDetail: 'Final' } },
      competitions: [{ competitors: [
        { homeAway: 'home', score: '108', team: team('New Orleans', 'Pelicans', 'New Orleans Pelicans'),
          leaders: [{ name: 'points', leaders: [{ value: 24, athlete: { displayName: 'Zion Williamson' } }] }] },
        { homeAway: 'away', score: '116', team: team('Denver', 'Nuggets', 'Denver Nuggets'),
          leaders: [{ name: 'points', leaders: [{ value: 26, athlete: { displayName: 'Nikola Jokic' } }] }] },
      ] }],
    },
    {
      status: { type: { completed: true, state: 'post', shortDetail: 'Final/OT' } },
      competitions: [{ competitors: [
        { homeAway: 'home', score: '121', team: team('Los Angeles', 'Lakers', 'Los Angeles Lakers'),
          leaders: [{ name: 'points', leaders: [{ value: 33, athlete: { displayName: 'Luka Doncic' } }] }] },
        { homeAway: 'away', score: '119', team: team('LA', 'Clippers', 'LA Clippers'),
          leaders: [{ name: 'points', leaders: [{ value: 30, athlete: { displayName: 'James Harden' } }] }] },
      ] }],
    },
  ],
};

test('noite anterior: vira às 6h de Brasília', () => {
  // 15/11 01:00 BRT (04:00 UTC): ainda vale a noite de 13/11? Não: antes das 6h vale a véspera de ontem.
  assert.equal(briefing.referenceDate(Date.parse('2026-11-15T04:00:00Z')), '2026-11-13');
  // 15/11 06:30 BRT: a noite de 14/11.
  assert.equal(briefing.referenceDate(Date.parse('2026-11-15T09:30:00Z')), '2026-11-14');
  // 15/11 23:00 BRT: ainda a noite de 14/11.
  assert.equal(briefing.referenceDate(Date.parse('2026-11-16T02:00:00Z')), '2026-11-14');
  assert.equal(briefing.spokenDate('2026-11-14'), 'sábado, 14 de novembro');
});

test('ESPN: cidade como nome do time, apelido em Los Angeles, prorrogação e cestinha', () => {
  const [a, b] = briefing.parseEspn(espn);
  assert.deepEqual([a.home, a.away, a.homeScore, a.awayScore, a.final], ['New Orleans', 'Denver', 108, 116, true]);
  assert.deepEqual(a.top, { name: 'Nikola Jokic', pts: 26, team: 'Denver' });
  assert.deepEqual([b.home, b.away, b.overtime], ['Lakers', 'Clippers', true]);
});

test('texto e voz: vencedor primeiro, "em casa"/"fora de casa", nomes em inglês na voz', () => {
  const nba = briefing.parseEspn(espn);
  const nbb = [{ league: 'NBB', home: 'Flamengo', away: 'Franca', homeScore: 88, awayScore: 80, final: true, overtime: false, top: { name: 'Gui Deodato', team: 'Flamengo', pts: 22 } }];
  const { text, ssml } = briefing.compose({ date: '2026-11-14', nbb, nba });
  assert.match(text, /^Nas Quadras\. Resultados de sábado, 14 de novembro\./);
  assert.match(text, /No NBB: um jogo\. Flamengo venceu Franca por 88 a 80, em casa\. Gui Deodato fez 22 pontos\./);
  assert.match(text, /Denver venceu New Orleans por 116 a 108, fora de casa\. Nikola Jokic fez 26 pontos\./);
  assert.match(text, /Lakers venceu Clippers por 121 a 119, na prorrogação, em casa\./);
  assert.match(text, /Dados: LNB e ESPN\./);
  assert.match(ssml, /^<speak>.*<\/speak>$/s);
  assert.match(ssml, /<lang xml:lang="en-US">Nikola Jokic<\/lang>/);
  assert.ok(!/<lang[^>]*>Flamengo/.test(ssml), 'times do NBB na voz normal');
});

test('dia sem jogos e erro da ESPN', () => {
  assert.match(briefing.compose({ date: '2026-11-16', nbb: [], nba: [] }).text, /Não teve jogo do NBB nem da NBA\./);
  const nbb = [{ league: 'NBB', home: 'Minas', away: 'Pinheiros', homeScore: 70, awayScore: 75, final: true, top: null }];
  const t = briefing.compose({ date: '2026-11-16', nbb, nba: [], nbaError: 'ESPN: HTTP 500' }).text;
  assert.match(t, /Pinheiros venceu Minas por 75 a 70, fora de casa\./);
  assert.match(t, /Os resultados da NBA não estão disponíveis agora\./);
});

test('NBB: guarda o jogo ao vivo, completa com o cestinha no fim e mantém o dia em que começou', async () => {
  const env = { DB: d1() };
  let status = 'live';
  const list = async () => [
    { id: '27150', home: 'FLAMENGO', away: 'FRANCA', homeScore: status === 'live' ? 40 : 88, awayScore: status === 'live' ? 38 : 80, period: 4, status },
    { id: '27151', home: 'MINAS', away: 'BAURU', homeScore: 0, awayScore: 0, period: 1, status: 'scheduled' },
  ];
  let detailCalls = 0;
  const getGame = async () => {
    detailCalls++;
    return {
      competition: '2026/2027 - NBB CAIXA', period: 4,
      home: { name: 'Flamengo', score: 88 }, away: { name: 'Franca', score: 80 },
      leaders: { home: { pts: [{ name: 'Gui Deodato', value: 22 }] }, away: { pts: [{ name: 'Lucas Dias', value: 19 }] } },
    };
  };
  // 14/11 21:00 BRT: ao vivo.
  await briefing.captureNbb(env, { now: Date.parse('2026-11-15T00:00:00Z'), list, getGame });
  assert.equal(detailCalls, 0);
  assert.deepEqual(await briefing.nbbResults(env, '2026-11-14'), [], 'jogo em andamento não entra no resumo');
  // 15/11 00:10 BRT: acabou (já é outro dia).
  status = 'final';
  await briefing.captureNbb(env, { now: Date.parse('2026-11-15T03:10:00Z'), list, getGame });
  await briefing.captureNbb(env, { now: Date.parse('2026-11-15T03:20:00Z'), list, getGame });
  assert.equal(detailCalls, 1, 'o jogo completo é lido uma vez só');
  const res = await briefing.nbbResults(env, '2026-11-14');
  assert.equal(res.length, 1);
  assert.deepEqual([res[0].home, res[0].homeScore, res[0].awayScore, res[0].top.name, res[0].top.pts], ['Flamengo', 88, 80, 'Gui Deodato', 22]);
});

test('NBB: outros campeonatos da LNB ficam de fora', async () => {
  const env = { DB: d1() };
  const list = async () => [{ id: '9', home: 'A', away: 'B', homeScore: 60, awayScore: 50, period: 4, status: 'final' }];
  const getGame = async () => ({ competition: 'LDB 2026', period: 4, home: { name: 'A', score: 60 }, away: { name: 'B', score: 50 }, leaders: {} });
  await briefing.captureNbb(env, { now: Date.parse('2026-11-15T00:00:00Z'), list, getGame });
  assert.deepEqual(await briefing.nbbResults(env, '2026-11-14'), []);
});

test('feed do Resumo de Notícias da Alexa', () => {
  const f = briefing.flashBriefing({ date: '2026-11-14', title: 'Nas Quadras: resultados de sábado, 14 de novembro', text: 'a\n\nb', updatedAt: '2026-11-15T09:05:00.123Z' }, 'https://nasquadras.online');
  assert.deepEqual(f, {
    uid: 'urn:nasquadras:briefing:2026-11-14',
    updateDate: '2026-11-15T09:05:00.0Z',
    titleText: 'Nas Quadras: resultados de sábado, 14 de novembro',
    mainText: 'a b',
    redirectionUrl: 'https://nasquadras.online/resultados',
  });
});
