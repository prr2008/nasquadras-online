// Leitura dos dados de tempo real da LNB (lnb.com.br).
// O próprio site usa estes JSON na página "Tempo real" de cada partida:
//   /ws/tempo_real_bybr/partidas.json             -> jogos do dia
//   /ws/tempo_real_bybr/json/<ID>_tempo_real.json -> um jogo completo
// Não é uma API documentada: se a LNB mudar o formato, este arquivo é o
// único ponto a ajustar.

const BASE = 'https://lnb.com.br';
const UA = 'NasQuadrasOnline/1.0 (cobertura jornalistica; +https://nasquadras-online.p-rodrigues.workers.dev)';
const CACHE_SECONDS = 15; // várias telas abertas não multiplicam as consultas à LNB

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`LNB: HTTP ${res.status} ao buscar dados do jogo.`);
  try {
    return await res.json();
  } catch {
    throw new Error('LNB: resposta em formato inesperado.');
  }
}

// ---------- Utilitários de parsing ----------

/** "18/41 (43.9)" -> 18 ; "7" -> 7 ; "" -> 0 */
export const first = (v) => {
  const n = parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : 0;
};

/** "4/8 (50.0)" -> { made: 4, att: 8 } */
export const madeAtt = (v) => {
  const m = String(v ?? '').match(/(\d+)\s*\/\s*(\d+)/);
  return m ? { made: Number(m[1]), att: Number(m[2]) } : { made: 0, att: 0 };
};

/** "2+9" (ofensivo+defensivo) -> 11 */
export const rebTotal = (v) => String(v ?? '').split('+').reduce((s, x) => s + first(x), 0);

/** Valor do total (índice 0) ou de um quarto (índice 1..n) num campo em lista. */
const at = (arr, i = 0) => (Array.isArray(arr) ? arr[i] : arr);

export function periodLabel(q, status) {
  if (status === 'final') return 'Final';
  if (status === 'scheduled') return 'Não começou';
  if (q > 4) return q === 5 ? 'Prorrogação' : `${q - 4}ª prorrogação`;
  return `${q}º quarto`;
}

/** Status textual a partir dos campos da LNB. "2" = encerrado (confirmado). */
export function gameStatus(p, totalPoints) {
  if (String(p.status) === '2') return 'final';
  const q = first(p.quarto);
  if (String(p.aovivo) === '1' || String(p.status) === '1' || totalPoints > 0 || q > 1) return 'live';
  return 'scheduled';
}

// ---------- Jogos do dia ----------

export async function listToday() {
  const data = await getJson(`/ws/tempo_real_bybr/partidas.json?v=${Math.floor(Date.now() / 15000)}`);
  const list = Array.isArray(data?.partidas) ? data.partidas : [];
  return list.map((g) => {
    const h = first(g.pontos1);
    const a = first(g.pontos2);
    const status = gameStatus(g, h + a);
    const q = first(g.quarto) || 1;
    return {
      id: String(g.id),
      home: g.equipe1,
      away: g.equipe2,
      homeScore: h,
      awayScore: a,
      period: q,
      clock: g.tempo || '',
      status,
      label: periodLabel(q, status),
      start: (g.start_time || '').replace(/\s*min$/, '').replace(/h\s*/, 'h'),
    };
  });
}

// ---------- Descobrir o ID a partir do que o usuário colar ----------

export async function resolveMatchId(input) {
  const s = String(input || '').trim();
  if (/^\d{3,8}$/.test(s)) return s;
  let url;
  try { url = new URL(s); } catch { throw new Error('Cole o link da página do jogo na LNB ou o número da partida.'); }
  if (!/(^|\.)lnb\.com\.br$/.test(url.hostname)) throw new Error('O link precisa ser do site lnb.com.br.');
  const res = await fetch(`${BASE}${url.pathname}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`LNB: HTTP ${res.status} ao abrir a página do jogo.`);
  const html = await res.text();
  const m = html.match(/id=["']matchID["'][^>]*value=["'](\d+)["']/) || html.match(/value=["'](\d+)["'][^>]*id=["']matchID["']/);
  if (!m) throw new Error('Não encontrei o jogo nessa página. Use o link da página "Tempo real" da partida.');
  return m[1];
}

// ---------- Um jogo completo ----------

function team(raw, side, players) {
  const quarters = Array.isArray(raw.pontos) ? raw.pontos.slice(1).map(first) : [];
  const roster = players
    .filter((p) => String(p.equipe) === String(raw.id))
    .map((p) => ({
      id: String(p.id),
      name: p.nome,
      number: p.numero,
      starter: Boolean(p.titular),
      onCourt: Boolean(p.em_quadra),
      min: at(p.tempo) || '00:00',
      pts: first(at(p.pontos)),
      reb: rebTotal(at(p.reb)),
      ast: first(at(p.ass)),
      stl: first(at(p.br)),
      blk: first(at(p.to)),
      three: madeAtt(at(p.p3)),
      eff: first(at(p.ef)),
      // por quarto: índice 0 = 1º quarto
      byQuarter: (Array.isArray(p.pontos) ? p.pontos.slice(1) : []).map((v, i) => ({
        pts: first(v),
        reb: rebTotal(at(p.reb, i + 1)),
        ast: first(at(p.ass, i + 1)),
      })),
    }));
  return {
    side,
    id: String(raw.id),
    name: raw.nome,
    short: raw.sigla,
    coach: raw.tecnico || '',
    quarters,
    fouls: first(at(raw.faltas)),
    reb: rebTotal(at(raw.reb)),
    ast: first(at(raw.ass)),
    three: madeAtt(at(raw.p3)),
    players: roster,
  };
}

const top = (players, key, n = 3) => players
  .filter((p) => p[key] > 0)
  .sort((a, b) => b[key] - a[key] || b.eff - a.eff)
  .slice(0, n)
  .map((p) => ({ name: p.name, number: p.number, value: p[key] }));

const topInQuarter = (players, qIndex, key, n = 2) => players
  .map((p) => ({ name: p.name, number: p.number, value: p.byQuarter[qIndex]?.[key] || 0 }))
  .filter((p) => p.value > 0)
  .sort((a, b) => b.value - a.value)
  .slice(0, n);

/** Converte o JSON bruto da LNB num formato simples para a interface. */
export function normalizeGame(raw) {
  const p = raw.partida || {};
  const players = Array.isArray(raw.jogadores) ? raw.jogadores : [];
  const home = team(raw.equipe1 || {}, 'home', players);
  const away = team(raw.equipe2 || {}, 'away', players);
  const geral = raw.placar?.geral || {};
  home.score = first(geral.pontos1);
  away.score = first(geral.pontos2);

  const status = gameStatus(p, home.score + away.score);
  const period = first(p.quarto) || 1;

  const quarters = (raw.placar?.quartos || []).map((q) => ({
    q: first(q.quarto),
    home: first(q.pontos1),
    away: first(q.pontos2),
  })).filter((q) => q.home + q.away > 0 || q.q <= period);

  const byId = new Map(players.map((pl) => [String(pl.id), pl.nome]));
  const teamShort = (id) => (String(id) === home.id ? home.short : String(id) === away.id ? away.short : '');

  const plays = (raw.jogadas || []).slice(0, 25).map((j) => ({
    id: String(j.id),
    type: j.tipo,
    period: first(j.quarto),
    clock: j.tempo,
    score: j.placar,
    team: teamShort(j.equipe),
    player: byId.get(String(j.id_jogador)) || '',
    title: j.title,
    text: String(j.desc || j.msg || '').replace(/\s+/g, ' ').trim(),
    scoring: ['A2C', 'A3C', 'LLC'].includes(j.tipo),
  }));

  // Quarto de referência para "destaques do quarto": o atual se estiver em
  // andamento, ou o último já disputado.
  const qIndex = Math.max(0, Math.min(period, Math.max(home.quarters.length, 1)) - 1);

  return {
    id: String(p.id || ''),
    venue: p.local || '',
    date: p.data || '',
    competition: p.campeonato || '',
    status,
    period,
    clock: p.tempo || '',
    label: periodLabel(period, status),
    home,
    away,
    quarters,
    leaders: {
      home: { pts: top(home.players, 'pts'), reb: top(home.players, 'reb'), ast: top(home.players, 'ast') },
      away: { pts: top(away.players, 'pts'), reb: top(away.players, 'reb'), ast: top(away.players, 'ast') },
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
  if (!/^\d{3,8}$/.test(String(id))) throw new Error('ID de partida inválido.');
  const raw = await getJson(`/ws/tempo_real_bybr/json/${id}_tempo_real.json?v=${Math.floor(Date.now() / 15000)}`);
  if (!raw?.partida) throw new Error('LNB: dados do jogo ainda não disponíveis.');
  const game = normalizeGame(raw);
  // Na interface, o box score completo não é necessário: mantém só o resumo.
  for (const t of [game.home, game.away]) {
    t.players = t.players.map(({ byQuarter, ...rest }) => rest);
  }
  return game;
}
