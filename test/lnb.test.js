// Testes do leitor da LNB com um JSON no mesmo formato do site
// (valores do jogo Pinheiros 75 x 63 União Corinthians, 27/10/2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { first, madeAtt, rebTotal, normalizeGame, gameStatus, listToday, resolveMatchId } from '../src/lnb.js';

const player = (id, nome, numero, equipe, { pts, reb, ast, p3 = ['0/0 (0.0)', '0/0 (0.0)', '0/0 (0.0)', '0/0 (0.0)', '0/0 (0.0)'], titular = false }) => ({
  id, nome, numero, equipe, titular, em_quadra: false,
  tempo: ['25:06', '04:13', '07:52', '06:09', '06:52'],
  pontos: pts, reb, ass: ast, p3,
  faltas: ['2', '0', '1', '1', '0'], br: ['1', '0', '0', '1', '0'], to: ['0', '0', '0', '0', '0'],
  pm: ['10', '0', '0', '0', '0'], ef: ['15', '0', '0', '0', '0'],
});

const raw = {
  partida: { id: '27133', local: 'Poliesportivo H. Villaboim', data: '27/10/2026 20:30', quarto: '4', tempo: '00:00', status: '2', aovivo: '0', campeonato: '2026/2027 - NBB CAIXA' },
  equipe1: { id: '18', nome: 'Pinheiros', sigla: 'PIN', tecnico: 'Gustavo De Conti',
    pontos: ['75/175 (42.9)', '22/50 (44.0)', '13/45 (28.9)', '24/48 (50.0)', '16/32 (50.0)'],
    faltas: ['22'], reb: ['10+30', '2+9', '2+11', '2+5', '2+4'], ass: ['16'], p3: ['12/31 (38.7)'] },
  equipe2: { id: '281', nome: 'União Corinthians', sigla: 'UCO', tecnico: 'Técnico UCO',
    pontos: ['63/184 (34.2)', '13/41 (31.7)', '10/56 (17.9)', '22/45 (48.9)', '18/42 (42.9)'],
    faltas: ['18'], reb: ['8+28'], ass: ['12'], p3: ['7/30 (23.3)'] },
  placar: {
    geral: { pontos1: '75', pontos2: '63' },
    quartos: [
      { quarto: '1', pontos1: '22', pontos2: '13' }, { quarto: '2', pontos1: '13', pontos2: '10' },
      { quarto: '3', pontos1: '24', pontos2: '22' }, { quarto: '4', pontos1: '16', pontos2: '18' },
    ],
  },
  jogadores: [
    player('13976', 'Bridgewater', '2', '18', {
      pts: ['18/41 (43.9)', '0/3 (0.0)', '6/9 (66.7)', '8/14 (57.1)', '4/15 (26.7)'],
      reb: ['1+4', '0+1', '0+1', '1+1', '0+1'], ast: ['2', '0', '1', '1', '0'],
      p3: ['3/7 (42.9)', '0/1 (0.0)', '1/2 (50.0)', '2/3 (66.7)', '0/1 (0.0)'],
    }),
    player('13973', 'Munford', '11', '18', {
      pts: ['16/30 (53.3)', '7/9 (77.8)', '2/7 (28.6)', '3/6 (50.0)', '4/8 (50.0)'],
      reb: ['2+5', '1+1', '0+2', '1+1', '0+1'], ast: ['3', '1', '0', '1', '1'], titular: true,
    }),
    player('12826', 'Gregate', '7', '18', {
      pts: ['7/20 (35.0)', '2/5', '0/5', '3/5', '2/5'], reb: ['1+5', '0+2', '0+2', '1+1', '0+0'], ast: ['5', '2', '1', '1', '1'],
    }),
    player('145', 'Renato', '9', '281', {
      pts: ['18/45 (40.0)', '4/10', '2/12', '8/12', '4/11'], reb: ['3+7', '1+2', '1+2', '1+2', '0+1'], ast: ['4', '1', '1', '1', '1'],
    }),
    player('12390', 'Jonatan', '5', '281', {
      pts: ['6/20 (30.0)', '2/5', '0/5', '2/5', '2/5'], reb: ['0+2', '0+1', '0+0', '0+1', '0+0'], ast: ['4', '1', '1', '1', '1'],
    }),
    player('99999', 'Lucas', '0', '281', { pts: ['0/0 (0.0)'], reb: ['0+0'], ast: ['0'] }),
  ],
  jogadas: [
    { id: '1', id_jogador: '', equipe: '', tipo: 'FIQ', tempo: '00:00', quarto: '4', placar: '75 x 63', title: 'FIM DE QUARTO', desc: 'Fim  do quarto quarto.' },
    { id: '2', id_jogador: '12826', equipe: '18', tipo: 'BOR', tempo: '00:01', quarto: '4', placar: '75 x 63', title: 'Bola recuperada', desc: 'Gregate recupera a bola.' },
    { id: '3', id_jogador: '13976', equipe: '18', tipo: 'LLC', tempo: '00:12', quarto: '4', placar: '75 x 63', title: '+1 PONTO', desc: 'Bridgewater acerta o lance livre.' },
  ],
};

test('parsers dos campos da LNB', () => {
  assert.equal(first('18/41 (43.9)'), 18);
  assert.equal(first(''), 0);
  assert.deepEqual(madeAtt('3/7 (42.9)'), { made: 3, att: 7 });
  assert.equal(rebTotal('2+9'), 11);
});

test('status: "2" é jogo encerrado; placar zerado é jogo não iniciado', () => {
  assert.equal(gameStatus({ status: '2' }, 150), 'final');
  assert.equal(gameStatus({ status: '0', quarto: '1', aovivo: '0' }, 0), 'scheduled');
  assert.equal(gameStatus({ status: '1', quarto: '2' }, 40), 'live');
});

test('normaliza placar, parciais, times e status', () => {
  const g = normalizeGame(raw);
  assert.equal(g.status, 'final');
  assert.equal(g.label, 'Final');
  assert.equal(g.home.name, 'Pinheiros');
  assert.equal(g.home.short, 'PIN');
  assert.equal(g.home.score, 75);
  assert.equal(g.away.score, 63);
  assert.deepEqual(g.home.quarters, [22, 13, 24, 16]);
  assert.deepEqual(g.quarters.map((q) => `${q.home}-${q.away}`), ['22-13', '13-10', '24-22', '16-18']);
  assert.equal(g.home.reb, 40);
});

test('jogadores ficam no time certo e os líderes saem dos totais', () => {
  const g = normalizeGame(raw);
  assert.deepEqual(g.home.players.map((p) => p.name), ['Bridgewater', 'Munford', 'Gregate']);
  assert.deepEqual(g.away.players.map((p) => p.name), ['Renato', 'Jonatan', 'Lucas']);
  assert.deepEqual(g.leaders.home.pts.map((p) => `${p.name} ${p.value}`), ['Bridgewater 18', 'Munford 16', 'Gregate 7']);
  assert.equal(g.leaders.home.reb[0].name, 'Munford');
  assert.equal(g.leaders.home.reb[0].value, 7);
  assert.equal(g.leaders.home.ast[0].name, 'Gregate');
  assert.equal(g.leaders.away.pts[0].name, 'Renato');
  assert.ok(!g.leaders.away.pts.some((p) => p.name === 'Lucas'), 'quem não pontuou não entra');
  assert.deepEqual(g.home.players[0].three, { made: 3, att: 7 });
});

test('destaques do quarto usam os pontos daquele quarto', () => {
  const g = normalizeGame(raw);
  assert.equal(g.quarterLeaders.period, 4);
  assert.deepEqual(g.quarterLeaders.home.map((p) => `${p.name} ${p.value}`), ['Bridgewater 4', 'Munford 4']);
  const q3 = normalizeGame({ ...raw, partida: { ...raw.partida, quarto: '3', status: '1' } });
  assert.equal(q3.status, 'live');
  assert.equal(q3.label, '3º quarto');
  assert.deepEqual(q3.quarterLeaders.home.map((p) => `${p.name} ${p.value}`), ['Bridgewater 8', 'Munford 3']);
});

test('jogadas: nome do jogador, sigla do time, texto limpo e marcação de cesta', () => {
  const g = normalizeGame(raw);
  assert.equal(g.plays[0].text, 'Fim do quarto quarto.');
  assert.equal(g.plays[2].player, 'Bridgewater');
  assert.equal(g.plays[2].team, 'PIN');
  assert.equal(g.plays[2].scoring, true);
  assert.equal(g.plays[1].scoring, false);
});

test('prorrogação vira rótulo próprio', () => {
  const g = normalizeGame({ ...raw, partida: { ...raw.partida, quarto: '5', status: '1' } });
  assert.equal(g.label, 'Prorrogação');
});

test('lista de jogos do dia a partir do partidas.json', async () => {
  globalThis.fetch = async (url) => {
    assert.match(String(url), /partidas\.json/);
    return new Response(JSON.stringify({ partidas: [
      { id: '27131', equipe1: 'MIN', equipe2: 'PAT', pontos1: '86', pontos2: '65', quarto: '4', tempo: '00:00', status: '2', aovivo: '0', start_time: '19h 00min' },
      { id: '27140', equipe1: 'CAP', equipe2: 'FRA', pontos1: '', pontos2: '', quarto: '1', tempo: '10:00', status: '0', aovivo: '0', start_time: '19h 00min' },
    ] }));
  };
  const games = await listToday();
  assert.deepEqual(games.map((g) => `${g.id} ${g.home} ${g.homeScore}x${g.awayScore} ${g.away} ${g.status} ${g.start}`), [
    '27131 MIN 86x65 PAT final 19h00',
    '27140 CAP 0x0 FRA scheduled 19h00',
  ]);
});

test('descobre o ID a partir do link da página do jogo', async () => {
  globalThis.fetch = async () => new Response('<input id="site-url" type="hidden" value="https://lnb.com.br"> <input id="matchID" type="hidden" value="27133">');
  assert.equal(await resolveMatchId('https://lnb.com.br/partidas/nbb-2026-2027-pinheiros-x-ceisc-uniao-corinthians-27102026-2030/'), '27133');
  assert.equal(await resolveMatchId('27133'), '27133');
  await assert.rejects(resolveMatchId('https://exemplo.com/jogo'), /lnb\.com\.br/);
});
