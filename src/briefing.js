// Resumo diário "Nas Quadras": resultados da noite anterior do NBB e da NBA,
// em texto (atalho da Siri, site) e em voz (Alexa). Fontes:
//   NBB -> lista de jogos do dia da LNB, guardada no D1 ao longo da noite
//          (a LNB só mostra os jogos do dia; de manhã a lista já está vazia).
//   NBA -> placar da ESPN por data (site.api.espn.com, JSON público).
// "Noite anterior" = véspera no horário de Brasília; a virada é às 6h, depois
// que acabam os jogos da NBA que vão até de madrugada.

import * as lnb from './lnb.js';

const TZ = 'America/Sao_Paulo';
const FLIP_HOURS = 6;
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const UA = 'Mozilla/5.0 (compatible; NasQuadrasOnline/1.0; +https://nasquadras.online)';
const CACHE_KEY = 'briefing:';

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// ---------- Datas ----------

/** "AAAA-MM-DD" de um instante no horário de Brasília. */
export function brtDate(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

/** Data dos jogos "da noite anterior" em relação a `now`. */
export function referenceDate(now = Date.now()) {
  const d = new Date(`${brtDate(now - FLIP_HOURS * 3600e3)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** "sábado, 14 de novembro" */
export function spokenDate(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`;
}

// ---------- NBB: guarda os jogos do dia no D1 ----------

/**
 * Lê a lista de jogos do dia da LNB e guarda/atualiza no D1. Jogos encerrados
 * ganham o cestinha (uma consulta ao jogo completo, só uma vez por jogo).
 */
export async function captureNbb(env, { now = Date.now(), list = lnb.listToday, getGame = lnb.getGame } = {}) {
  const games = await list();
  let saved = 0;
  for (const g of games) {
    if (g.status === 'scheduled') continue;
    const cur = await env.DB.prepare('SELECT status, top_name FROM nbb_results WHERE id = ?').bind(g.id).first();
    if (cur?.status === 'final' && cur.top_name) continue;
    let detail = null;
    if (g.status === 'final') {
      try { detail = await getGame(g.id); } catch (err) { console.error('nbb detalhe', g.id, err.message); }
    }
    const comp = detail?.competition || '';
    if (detail && comp && !/NBB/i.test(comp)) continue; // outros campeonatos da LNB ficam de fora
    const top = detail ? topScorer(detail) : null;
    await env.DB.prepare(
      `INSERT INTO nbb_results (id, game_date, home, away, home_score, away_score, status, period, competition, top_name, top_team, top_pts, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       -- game_date fica o da primeira leitura: jogo que passa da meia-noite continua no dia em que começou.
       ON CONFLICT(id) DO UPDATE SET home = excluded.home, away = excluded.away, home_score = excluded.home_score,
         away_score = excluded.away_score, status = excluded.status, period = excluded.period,
         competition = COALESCE(NULLIF(excluded.competition, ''), nbb_results.competition),
         top_name = COALESCE(excluded.top_name, nbb_results.top_name), top_team = COALESCE(excluded.top_team, nbb_results.top_team),
         top_pts = COALESCE(excluded.top_pts, nbb_results.top_pts), updated_at = excluded.updated_at`,
    ).bind(
      g.id, brtDate(now), detail?.home.name || g.home, detail?.away.name || g.away,
      detail?.home.score ?? g.homeScore, detail?.away.score ?? g.awayScore, g.status, detail?.period || g.period,
      comp, top?.name || null, top?.team || null, top?.pts ?? null, now,
    ).run();
    saved++;
  }
  return { games: games.length, saved };
}

function topScorer(game) {
  const h = game.leaders?.home?.pts?.[0];
  const a = game.leaders?.away?.pts?.[0];
  if (!h && !a) return null;
  const best = !a || (h && h.value >= a.value) ? { p: h, t: game.home.name } : { p: a, t: game.away.name };
  return { name: best.p.name, team: best.t, pts: best.p.value };
}

export async function nbbResults(env, date) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM nbb_results WHERE game_date = ? AND status = 'final' ORDER BY updated_at",
  ).bind(date).all();
  return (results || []).map((r) => ({
    league: 'NBB',
    home: r.home,
    away: r.away,
    homeScore: r.home_score,
    awayScore: r.away_score,
    final: true,
    overtime: r.period > 4,
    top: r.top_name ? { name: r.top_name, team: r.top_team, pts: r.top_pts } : null,
  }));
}

// ---------- NBA: placar da ESPN ----------

/** Nome falado do time: a cidade ("Denver"); em Los Angeles, o apelido ("Lakers"). */
export function nbaTeamName(team) {
  const loc = team.location || '';
  if (!loc || /^(LA|Los Angeles)$/i.test(loc)) return team.shortDisplayName || team.displayName;
  return loc;
}

export function parseEspn(data) {
  return (data?.events || []).map((ev) => {
    const comp = ev.competitions?.[0] || {};
    const side = (ha) => (comp.competitors || []).find((c) => c.homeAway === ha) || {};
    const h = side('home');
    const a = side('away');
    const leader = (c) => {
      const l = (c.leaders || []).find((x) => x.name === 'points')?.leaders?.[0];
      return l ? { name: l.athlete?.displayName || '', pts: Number(l.value ?? l.displayValue) || 0, team: nbaTeamName(c.team || {}) } : null;
    };
    const lh = leader(h);
    const la = leader(a);
    const type = ev.status?.type || {};
    return {
      league: 'NBA',
      home: nbaTeamName(h.team || {}),
      away: nbaTeamName(a.team || {}),
      homeScore: Number(h.score) || 0,
      awayScore: Number(a.score) || 0,
      final: Boolean(type.completed),
      live: type.state === 'in',
      overtime: /OT/i.test(type.shortDetail || type.detail || ''),
      top: !lh ? la : !la ? lh : (lh.pts >= la.pts ? lh : la),
    };
  });
}

export async function nbaResults(date, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${ESPN}?dates=${date.replace(/-/g, '')}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`ESPN: HTTP ${res.status}`);
  return parseEspn(await res.json());
}

// ---------- Texto e voz ----------

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Nomes da NBA em inglês na voz da Alexa. */
const en = (s, ssml) => (ssml ? `<lang xml:lang="en-US">${esc(s)}</lang>` : s);

function gameLine(g, ssml) {
  const nba = g.league === 'NBA';
  const name = (s) => (nba ? en(s, ssml) : ssml ? esc(s) : s);
  const homeWon = g.homeScore >= g.awayScore;
  const [w, l, ws, ls] = homeWon ? [g.home, g.away, g.homeScore, g.awayScore] : [g.away, g.home, g.awayScore, g.homeScore];
  if (!g.final) return `${name(g.away)} e ${name(g.home)} ainda estavam em quadra: ${g.awayScore} a ${g.homeScore}.`;
  let s = `${name(w)} venceu ${name(l)} por ${ws} a ${ls}${g.overtime ? ', na prorrogação' : ''}${homeWon ? ', em casa' : ', fora de casa'}.`;
  if (g.top?.name && g.top.pts) {
    s += ` ${nba ? en(g.top.name, ssml) : ssml ? esc(g.top.name) : g.top.name} fez ${g.top.pts} pontos${g.top.team && g.top.team !== w ? ` para ${name(g.top.team)}` : ''}.`;
  }
  return s;
}

function section(label, games, ssml) {
  if (!games.length) return '';
  const n = games.length;
  const head = `${label}: ${n === 1 ? 'um jogo' : `${n} jogos`}.`;
  const sep = ssml ? ' <break time="400ms"/> ' : ' ';
  return [head, ...games.map((g) => gameLine(g, ssml))].join(sep);
}

/** Monta o resumo a partir dos jogos já lidos. */
export function compose({ date, nbb = [], nba = [], nbaError = null }) {
  const when = spokenDate(date);
  const build = (ssml) => {
    const parts = [`Nas Quadras. Resultados de ${when}.`];
    const sNbb = section('No NBB', nbb, ssml);
    const sNba = section('Na NBA', nba, ssml);
    if (!sNbb && !sNba) parts.push(nbaError ? 'Não consegui buscar os resultados agora. Tente de novo mais tarde.' : 'Não teve jogo do NBB nem da NBA.');
    if (sNbb) parts.push(sNbb);
    else if (sNba) parts.push('Não teve jogo do NBB.');
    if (sNba) parts.push(sNba);
    else if (sNbb) parts.push(nbaError ? 'Os resultados da NBA não estão disponíveis agora.' : 'Não teve jogo da NBA.');
    parts.push('Dados: LNB e ESPN. Mais em nasquadras ponto online.');
    return parts.join(ssml ? ' <break time="600ms"/> ' : '\n\n');
  };
  return { text: build(false), ssml: `<speak>${build(true)}</speak>` };
}

/**
 * Resumo da noite anterior (com cache no KV). Fica guardado por 6 horas quando
 * todos os jogos acabaram; com jogo em andamento ou erro, por 10 minutos.
 */
export async function get(env, { now = Date.now(), date = referenceDate(now), fresh = false } = {}) {
  const key = `${CACHE_KEY}${date}`;
  if (!fresh) {
    const cached = await env.KV.get(key, 'json');
    if (cached) return cached;
  }
  const nbb = await nbbResults(env, date);
  let nba = [];
  let nbaError = null;
  try { nba = await nbaResults(date); } catch (err) { nbaError = err.message; console.error('briefing nba', err.message); }
  const { text, ssml } = compose({ date, nbb, nba, nbaError });
  const done = !nbaError && nba.every((g) => g.final);
  const out = { nbaError, date, title: `Nas Quadras: resultados de ${spokenDate(date)}`, text, ssml, nbb, nba, updatedAt: new Date(now).toISOString(), complete: done };
  await env.KV.put(key, JSON.stringify(out), { expirationTtl: done ? 6 * 3600 : 600 });
  return out;
}

/** Formato do Resumo de Notícias da Alexa (Flash Briefing). */
export function flashBriefing(b, origin) {
  return {
    uid: `urn:nasquadras:briefing:${b.date}`,
    updateDate: `${b.updatedAt.slice(0, 19)}.0Z`,
    titleText: b.title,
    mainText: b.text.replace(/\n+/g, ' ').slice(0, 4500),
    redirectionUrl: `${origin}/resultados`,
  };
}
