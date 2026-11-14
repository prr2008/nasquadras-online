// Dados oficiais da FIBA (fiba.basketball) para os campeonatos das Américas.
// O próprio site da FIBA usa estas duas fontes na página de cada jogo:
//   - digital-api.fiba.basketball/hapi/getgdapgamesbycompetitionid  -> tabela de jogos
//     (com a chave pública do site, NEXT_CLIENT_APIM_SUBSCRIPTION_KEY)
//   - www.fiba.basketball/en/events/api/game-live-info/<jogo>/detail -> placar, box
//     score e lance a lance, atualizado a cada ~20 s durante o jogo
// Não é uma API documentada: se a FIBA mudar o formato, este arquivo é o único
// ponto a ajustar. O resultado tem o mesmo formato de lnb.normalizeGame, para o
// app usar os mesmos atalhos (Parciais, Cestinhas, Destaques, Do quarto…).

import { periodLabel } from './lnb.js';

const SITE = 'https://www.fiba.basketball';
const API = 'https://digital-api.fiba.basketball/hapi';
const UA = 'Mozilla/5.0 (compatible; NasQuadrasOnline/1.0; +https://nasquadras.online)';
// Chave pública que o site da FIBA entrega a qualquer visitante (não é segredo nosso).
const PUBLIC_KEY = '898cd5e7389140028ecb42943c47eb74';

/** Campeonatos disponíveis no app. Para incluir outro, basta uma linha. */
export const EVENTS = [
  { key: 'lsa', label: 'Liga Sul-Americana', short: 'LSA', competitionId: 209059, slug: 'liga-sudamericana-de-baloncesto-fiba-2026' },
];
export const eventByKey = (key) => EVENTS.find((e) => e.key === key) || EVENTS[0];

export const PREFIX = 'fiba:';
export const isFibaId = (id) => String(id || '').startsWith(PREFIX);
const gameNumber = (id) => String(id).replace(PREFIX, '');

async function getJson(url, headers = {}, cacheTtl = 15) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, cf: { cacheTtl, cacheEverything: true } });
  if (!res.ok) throw new Error(`FIBA: HTTP ${res.status} ao buscar dados.`);
  try { return await res.json(); } catch { throw new Error('FIBA: resposta em formato inesperado.'); }
}

// ---------- Situação do jogo ----------

// Códigos da FIBA: 0 planejado, 1 agendado, 2 aquecimento, 3 em andamento,
// 4 não oficial, 5 encerrado, 6 atrasado, 10 interrompido, 999 validado.
export function statusOf(code) {
  const c = Number(code);
  if ([4, 5, 999].includes(c)) return 'final';
  if ([2, 3, 10].includes(c)) return 'live';
  return 'scheduled';
}

/** "Q1".."Q4" -> 1..4 ; "OT1" -> 5 ; "OT2" -> 6 */
export function periodNumber(p) {
  const s = String(p || '');
  const q = s.match(/^Q(\d)$/i);
  if (q) return Number(q[1]);
  const ot = s.match(/^OT(\d*)$/i);
  if (ot) return 4 + (Number(ot[1]) || 1);
  return 1;
}

// ---------- Tabela de jogos ----------

/** Jogos de ontem até daqui a 3 dias (e os que estão ao vivo), do mais próximo de agora. */
export async function listGames(eventKey, now = Date.now()) {
  const ev = eventByKey(eventKey);
  const data = await getJson(`${API}/getgdapgamesbycompetitionid?gdapCompetitionId=${ev.competitionId}`, { 'Ocp-Apim-Subscription-Key': PUBLIC_KEY }, 30);
  const list = Array.isArray(data) ? data : [];
  return list
    .filter((g) => g?.teamA && g?.teamB)
    .map((g) => {
      const at = Date.parse(`${g.gameDateTimeUTC}Z`);
      const status = g.isLive ? 'live' : statusOf(g.liveGameStatus);
      const period = periodNumber(g.currentPeriod);
      return {
        id: `${PREFIX}${g.gameId}`,
        home: g.teamA.shortName || g.teamA.officialName,
        away: g.teamB.shortName || g.teamB.officialName,
        homeScore: Number(g.teamAScore) || 0,
        awayScore: Number(g.teamBScore) || 0,
        period,
        clock: g.chrono || '',
        status,
        label: periodLabel(period, status),
        at,
        start: Number.isFinite(at) ? new Date(at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '',
        round: g.round?.roundName || '',
        group: g.groupPairingCode || '',
      };
    })
    .filter((g) => g.status === 'live' || (g.at > now - 36 * 3600e3 && g.at < now + 72 * 3600e3))
    .sort((a, b) => (b.status === 'live') - (a.status === 'live') || Math.abs(a.at - now) - Math.abs(b.at - now));
}

// ---------- Descobrir o jogo a partir do que o usuário colar ----------

/** Aceita o link da página do jogo (…/games/131159-FLA-BRA) ou o número. */
export function resolveGameId(input) {
  const s = String(input || '').trim();
  if (/^\d{4,8}$/.test(s)) return `${PREFIX}${s}`;
  let url;
  try { url = new URL(s); } catch { throw new Error('Cole o link da página do jogo no site da FIBA ou o número do jogo.'); }
  if (!/(^|\.)fiba\.basketball$/.test(url.hostname)) throw new Error('O link precisa ser do site fiba.basketball.');
  const m = url.pathname.match(/\/games\/(\d{4,8})(?:-|$|\/)/);
  if (!m) throw new Error('Não encontrei o número do jogo nesse link. Use o link da página do jogo.');
  return `${PREFIX}${m[1]}`;
}

// ---------- Um jogo completo ----------

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function team(raw, side, names, byQuarter) {
  const players = (raw.Children || []).map((p) => {
    const s = p.Stats || {};
    const pid = String(p.Id || '').replace('P_', '');
    return {
      id: pid,
      name: names.get(pid) || p.Name || '',
      number: p.JerseyNumber || '',
      starter: Boolean(s.Starter),
      onCourt: Boolean(s.CB),
      min: s.TP || '00:00',
      pts: n(s.PTS),
      reb: n(s.REB),
      ast: n(s.AS),
      stl: n(s.ST),
      blk: n(s.BS),
      tov: n(s.TO), // erros (turnovers)
      three: { made: n(s.FG3M), att: n(s.FG3A) },
      eff: n(s.EFF),
      byQuarter: byQuarter.get(pid) || [],
    };
  });
  const s = raw.Stats || {};
  return {
    side,
    id: String(raw.Id || ''),
    name: raw.Name || '',
    short: raw.Code || '',
    coach: '',
    quarters: (raw.Periods || []).map((p) => n(p.Score)),
    fouls: n(s.A_FOUL),
    reb: n(s.REB),
    ast: n(s.AS),
    three: { made: n(s.FG3M), att: n(s.FG3A) },
    score: n(raw.Score ?? s.PTS),
    players,
  };
}

const top = (players, key, k = 3) => players
  .filter((p) => p[key] > 0)
  .sort((a, b) => b[key] - a[key] || b.eff - a.eff)
  .slice(0, k)
  .map((p) => ({ name: p.name, number: p.number, value: p[key] }));

const topInQuarter = (players, qIndex, key, k = 2) => players
  .map((p) => ({ name: p.name, number: p.number, value: p.byQuarter[qIndex]?.[key] || 0 }))
  .filter((p) => p.value > 0)
  .sort((a, b) => b.value - a.value)
  .slice(0, k);

function shotText(a, player) {
  const who = player || 'jogador';
  if (a.pts === 3) return `Bola de 3 de ${who}`;
  if (a.pts === 1) return `Lance livre de ${who}`;
  return `Cesta de 2 de ${who}`;
}

/** Converte o JSON do game-live-info da FIBA no formato usado pelo app. */
export function normalizeGame(raw, gameId) {
  const g = raw?.game?.content;
  if (!g) throw new Error('FIBA: os dados do jogo ainda não estão disponíveis (o jogo não começou?).');
  const comp = raw.gameCompetitors?.content || {};
  const names = new Map();
  for (const p of [...(comp.playersTeamA || []), ...(comp.playersTeamB || [])]) {
    names.set(String(p.personId), `${p.firstName || ''} ${p.lastName || ''}`.trim());
  }

  // Lance a lance (do mais antigo ao mais novo) e pontos/rebotes/assistências por quarto.
  const items = raw.periodActions?.content?.items || {};
  const actions = Object.entries(items)
    .flatMap(([q, block]) => (block.items || []).map((a) => ({ ...a, period: periodNumber(q) })))
    .sort((x, y) => n(x.order) - n(y.order));
  const byQuarter = new Map();
  const stat = (pid, qi, key, v) => {
    if (!pid) return;
    const list = byQuarter.get(pid) || [];
    while (list.length <= qi) list.push({ pts: 0, reb: 0, ast: 0 });
    list[qi][key] += v;
    byQuarter.set(pid, list);
  };
  for (const a of actions) {
    const pid = String(a.pId || '');
    const qi = a.period - 1;
    if (a.act === 'shot' && a.made) stat(pid, qi, 'pts', n(a.pts));
    else if (a.ac === 'REB') stat(pid, qi, 'reb', 1);
    else if (a.ac === 'ASS') stat(pid, qi, 'ast', 1);
  }

  const teams = Array.isArray(g.c) ? g.c : [];
  const rawA = teams.find((t) => t.Id === g.teamA?.Id) || teams[0] || {};
  const rawB = teams.find((t) => t.Id === g.teamB?.Id) || teams[1] || {};
  // Na FIBA, o time A é o mandante.
  const home = team(rawA, 'home', names, byQuarter);
  const away = team(rawB, 'away', names, byQuarter);
  home.score = n(g.teamA?.Score ?? home.score);
  away.score = n(g.teamB?.Score ?? away.score);

  const status = statusOf(g.status);
  const period = periodNumber(g.CurrentPeriod);
  const quarters = (g.quartersScores || [])
    .map((q) => ({ q: periodNumber(q.period), home: n(q.teamA), away: n(q.teamB) }))
    .filter((q) => q.home + q.away > 0 || q.q <= period);

  const shortOf = (oId) => (`T_${oId}` === rawA.Id ? home.short : `T_${oId}` === rawB.Id ? away.short : '');
  const plays = actions.slice().reverse().filter((a) => a.ac !== 'SUBST').slice(0, 25).map((a) => {
    const player = names.get(String(a.pId || '')) || '';
    const scoring = a.act === 'shot' && Boolean(a.made);
    return {
      id: String(a.Id),
      type: a.ac,
      period: a.period,
      clock: a.Time || '',
      score: `${n(a.SA)}-${n(a.SB)}`,
      team: a.oId ? shortOf(a.oId) : '',
      player,
      title: a.txt || '',
      text: scoring ? shotText(a, player) : String(a.txt || ''),
      scoring,
    };
  });

  const qIndex = Math.max(0, Math.min(period, Math.max(home.quarters.length, 1)) - 1);
  return {
    id: `${PREFIX}${gameId}`,
    source: 'fiba',
    venue: '',
    date: '',
    competition: 'FIBA',
    status,
    period,
    clock: g.RC || '',
    label: periodLabel(period, status),
    home,
    away,
    quarters,
    leaders: {
      home: { pts: top(home.players, 'pts'), reb: top(home.players, 'reb'), ast: top(home.players, 'ast'), tov: top(home.players, 'tov'), stl: top(home.players, 'stl'), blk: top(home.players, 'blk') },
      away: { pts: top(away.players, 'pts'), reb: top(away.players, 'reb'), ast: top(away.players, 'ast'), tov: top(away.players, 'tov'), stl: top(away.players, 'stl'), blk: top(away.players, 'blk') },
    },
    quarterLeaders: {
      period: qIndex + 1,
      home: topInQuarter(home.players, qIndex, 'pts'),
      away: topInQuarter(away.players, qIndex, 'pts'),
    },
    plays,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getGame(id) {
  const num = gameNumber(id);
  if (!/^\d{4,8}$/.test(num)) throw new Error('Número de jogo da FIBA inválido.');
  const raw = await getJson(`${SITE}/en/events/api/game-live-info/${num}/detail`, {}, 15);
  const game = normalizeGame(raw, num);
  for (const t of [game.home, game.away]) {
    t.players = t.players.map(({ byQuarter, ...rest }) => rest);
  }
  return game;
}
