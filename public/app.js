// Nas Quadras Online — interface de publicação ao vivo.

const $ = (sel) => document.querySelector(sel);
const THREADS_MAX = 500;
const BLUESKY_MAX = 300;
const X_MAX = 280; // só para o contador: o X recebe o texto pelo botão Copiar
const IMAGE_TARGET_BYTES = 950 * 1024;   // cabe no limite de imagem do Bluesky
const IMAGE_MAX_SIDE = 2048;
const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const PERIOD_LABEL = { '1Q': '1º quarto', '2Q': '2º quarto', INT: 'Intervalo', '3Q': '3º quarto', '4Q': '4º quarto', OT: 'Prorrogação', FINAL: 'Final' };

const seg = new Intl.Segmenter('pt-BR', { granularity: 'grapheme' });
const glen = (s) => { let n = 0; for (const _ of seg.segment(s)) n++; return n; };

// ---------- Estado salvo no aparelho ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(`nq:${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`nq:${k}`, JSON.stringify(v)); } catch { /* sem armazenamento */ } },
};

const state = {
  game: store.get('game', { away: '', home: '', sa: 0, sh: 0, period: '1Q' }),
  media: [],      // { id, file, kind, mime, width, height, alt, key, status, progress, preview }
  status: null,
  busy: false,
};

// ---------- API ----------
async function api(path, data, method = data === undefined ? 'GET' : 'POST') {
  const res = await fetch(path, {
    method,
    headers: data === undefined ? { 'X-NQ': '1' } : { 'Content-Type': 'application/json', 'X-NQ': '1' },
    body: data === undefined ? undefined : JSON.stringify(data),
    credentials: 'same-origin',
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') { showLogin(); throw new Error('Sessão expirada.'); }
  if (!res.ok) throw new Error(body.error || `Erro ${res.status}`);
  return body;
}

function toast(msg, ms = 3500) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, ms);
}

// ---------- Login ----------
function showLogin() { $('#app').hidden = true; $('#login').hidden = false; $('#password').focus(); }
function showApp() { $('#login').hidden = true; $('#app').hidden = false; }

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    await api('/api/login', { password: $('#password').value });
    $('#password').value = '';
    await boot();
  } catch (err) { $('#login-error').textContent = err.message; }
});

$('#logout').addEventListener('click', async () => {
  await api('/api/logout', {}).catch(() => {});
  showLogin();
});

// ---------- Contas ----------
function renderAccounts() {
  const s = state.status;
  $('#acc-threads').classList.toggle('on', !!s?.threads?.connected);
  $('#acc-bluesky').classList.toggle('on', !!s?.bluesky?.connected);
  $('#acc-threads').textContent = s?.threads?.username ? `@${s.threads.username}` : 'Threads';
  $('#acc-bluesky').textContent = s?.bluesky?.handle ? `@${s.bluesky.handle.replace('.bsky.social', '')}` : 'Bluesky';
}

function openDialog(title, html) {
  $('#dlg-title').textContent = title;
  $('#dlg-body').innerHTML = html;
  $('#account-dialog').showModal();
}

$('#acc-threads').addEventListener('click', () => {
  const t = state.status?.threads || {};
  if (t.connected) {
    const days = Math.max(0, Math.round((t.expiresAt - Date.now()) / 86400000));
    openDialog('Threads', `<p>Conectado como <strong>@${esc(t.username || '')}</strong>.</p>
      <p>O acesso é renovado automaticamente todo dia (válido por mais ${days} dias).</p>
      <div class="row"><button type="button" class="ghost" id="th-disconnect">Desconectar</button></div>`);
    $('#th-disconnect').onclick = async () => {
      await api('/api/threads/disconnect', {});
      $('#account-dialog').close();
      await refreshStatus();
    };
  } else {
    openDialog('Threads', `<p>Para conectar, a URL abaixo precisa estar cadastrada no app da Meta como <em>URL de redirecionamento</em>:</p>
      <p><code>${esc(state.status?.redirectUri || '')}</code></p>
      <div class="row"><a class="primary" style="text-decoration:none;padding:10px 14px" href="/auth/threads/start">Conectar Threads</a></div>`);
  }
});

$('#acc-bluesky').addEventListener('click', () => {
  const b = state.status?.bluesky || {};
  openDialog('Bluesky', b.connected
    ? `<p>Conectado como <strong>@${esc(b.handle)}</strong> com senha de app.</p>`
    : `<p>Não conectado.</p><p class="error">${esc(b.reason === 'not_configured'
      ? 'Cadastre BLUESKY_HANDLE e BLUESKY_APP_PASSWORD nos Secrets do Worker na Cloudflare.'
      : (b.reason || ''))}</p>`);
});

async function refreshStatus() {
  state.status = await api('/api/status');
  renderAccounts();
  renderThread();
}

// ---------- Fio da cobertura ----------
function threadOn() {
  return Boolean(state.status?.coverage?.active) && $('#thread-reply').checked;
}

function renderThread() {
  const c = state.status?.coverage || {};
  $('#thread-bar').classList.toggle('active', !!c.active);
  $('#thread-bar .thread-off').hidden = !!c.active;
  $('#thread-bar .thread-on').hidden = !c.active;
  if (!c.active) return renderWarnings();
  $('#thread-title').textContent = c.title ? `· ${c.title}` : '';
  const links = [];
  if (c.threads?.rootUrl) links.push(`<a href="${esc(c.threads.rootUrl)}" target="_blank" rel="noopener">Threads (${c.threads.count})</a>`);
  else if (c.threads?.count) links.push(`Threads (${c.threads.count})`);
  if (c.bluesky?.rootUrl) links.push(`<a href="${esc(c.bluesky.rootUrl)}" target="_blank" rel="noopener">Bluesky (${c.bluesky.count})</a>`);
  const started = c.startedAt ? new Date(c.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  $('#thread-meta').innerHTML = links.length
    ? `desde ${started} · ${links.join(' · ')}`
    : 'o próximo post abre o fio';
  renderWarnings();
}

async function refreshThread() {
  if (!state.status) return;
  state.status.coverage = await api('/api/coverage');
  renderThread();
}

$('#thread-start').addEventListener('click', async () => {
  const g = state.game;
  const title = g.away || g.home ? `${g.away || 'Mandante'} x ${g.home || 'Visitante'}` : '';
  state.status.coverage = await api('/api/coverage/start', { title });
  $('#thread-reply').checked = true;
  renderThread();
  toast('Fio iniciado: o próximo post abre o fio, os seguintes respondem a ele.');
});

$('#thread-stop').addEventListener('click', async () => {
  if (!confirm('Encerrar o fio? Os próximos posts sairão soltos.')) return;
  state.status.coverage = await api('/api/coverage/stop', {});
  renderThread();
});

$('#thread-reply').addEventListener('change', renderWarnings);

// ---------- Placar ----------
function renderGame() {
  const g = state.game;
  $('#away').value = g.away; $('#home').value = g.home;
  // Não sobrescreve o campo enquanto ele está sendo digitado.
  if (document.activeElement !== $('#sa')) $('#sa').value = g.sa;
  if (document.activeElement !== $('#sh')) $('#sh').value = g.sh;
  $('#period').value = g.period;
  store.set('game', g);
}

document.querySelectorAll('.score-btns').forEach((box) => {
  box.addEventListener('click', (e) => {
    const d = Number(e.target.dataset.d);
    if (!d) return;
    const k = box.dataset.team === 'a' ? 'sa' : 'sh';
    state.game[k] = Math.max(0, state.game[k] + d);
    navigator.vibrate?.(10);
    renderGame();
  });
});
// Placar digitado: aceita só números; ao sair do campo, corrige vazio para 0.
for (const id of ['sa', 'sh']) {
  const el = $(`#${id}`);
  el.addEventListener('focus', () => el.select());
  el.addEventListener('input', () => {
    const n = parseInt(el.value.replace(/\D/g, ''), 10);
    state.game[id] = Number.isFinite(n) ? Math.min(999, n) : 0;
    store.set('game', state.game);
  });
  el.addEventListener('blur', () => { el.value = state.game[id]; });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
}
$('#away').addEventListener('input', (e) => { state.game.away = e.target.value; store.set('game', state.game); });
$('#home').addEventListener('input', (e) => { state.game.home = e.target.value; store.set('game', state.game); });
$('#period').addEventListener('change', (e) => { state.game.period = e.target.value; renderGame(); });
$('#reset-game').addEventListener('click', () => {
  if (!confirm('Zerar placar e times?')) return;
  state.game = { away: '', home: '', sa: 0, sh: 0, period: '1Q' };
  renderGame();
});

function scoreLine() {
  const g = state.game;
  return `🏀 ${g.away || 'Mandante'} ${g.sa} x ${g.sh} ${g.home || 'Visitante'} | ${PERIOD_LABEL[g.period]}`;
}

function insertAtCursor(snippet) {
  const ta = $('#text');
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const before = value.slice(0, s);
  const sep = before && !/\s$/.test(before) ? ' ' : '';
  ta.value = before + sep + snippet + value.slice(e);
  const pos = (before + sep + snippet).length;
  ta.setSelectionRange(pos, pos);
  ta.focus();
  onTextChange();
}

$('#insert-score').addEventListener('click', () => insertAtCursor(`${scoreLine()}\n`));

$('#templates').addEventListener('click', (e) => {
  let t = e.target.dataset.t;
  if (!t) return;
  if (t === '{fimq}') t = `Fim do ${PERIOD_LABEL[state.game.period]}.\n${scoreLine()}\n`;
  if (t === '{final}') {
    state.game.period = 'FINAL'; renderGame();
    t = `FIM DE JOGO!\n${scoreLine()}\n`;
  }
  insertAtCursor(t);
});

// ---------- Jogo vinculado à LNB (placar automático) ----------
const LNB_POLL_MS = 30000;
state.lnb = store.get('lnb', null); // { id, label }
state.lnbGame = null;
let lnbTimer = null;

const ORD = (n) => `${n}º`;

/** Converte o período da LNB para o seletor do placar. */
function periodValue(g) {
  if (g.status === 'final') return 'FINAL';
  if (g.status === 'scheduled') return '1Q';
  if (g.period > 4) return 'OT';
  if (g.period === 2 && g.clock === '00:00') return 'INT';
  return `${Math.max(1, g.period)}Q`;
}

function renderLnb() {
  const linked = Boolean(state.lnb);
  $('#lnb-link').classList.toggle('on', linked);
  $('#lnb-status').hidden = !linked;
  $('#lnb-chips').hidden = !state.lnbGame;
  if (!linked) return;
  const g = state.lnbGame;
  const box = $('#lnb-status');
  box.classList.toggle('live', g?.status === 'live');
  box.classList.toggle('final', g?.status === 'final');
  box.classList.toggle('error', Boolean(state.lnbError));
  if (state.lnbError) {
    $('#lnb-text').textContent = `LNB: ${state.lnbError}`;
  } else if (g) {
    const when = new Date(g.fetchedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const clock = g.status === 'live' && g.clock ? ` ${g.clock}` : '';
    const st = g.status === 'live' ? 'Ao vivo' : g.status === 'final' ? 'Encerrado' : 'Não começou';
    $('#lnb-text').textContent = `${st} · ${g.label}${clock} · atualizado ${when}`;
  } else {
    $('#lnb-text').textContent = 'Buscando dados na LNB…';
  }
}

function applyLnbGame(g) {
  state.lnbGame = g;
  state.lnbError = null;
  state.game.away = g.home.name; // à esquerda: mandante
  state.game.home = g.away.name; // à direita: visitante
  state.game.sa = g.home.score;
  state.game.sh = g.away.score;
  state.game.period = periodValue(g);
  renderGame();
  renderLnb();
}

async function lnbRefresh() {
  if (!state.lnb) return;
  try {
    applyLnbGame(await api(`/api/lnb/game?id=${encodeURIComponent(state.lnb.id)}`));
  } catch (err) {
    state.lnbError = err.message;
    renderLnb();
  }
}

function lnbStartPolling() {
  clearInterval(lnbTimer);
  if (!state.lnb) return;
  lnbRefresh();
  lnbTimer = setInterval(() => {
    // Só consulta com a tela visível; quando o jogo acaba, para sozinho.
    if (document.visibilityState === 'visible' && state.lnbGame?.status !== 'final') lnbRefresh();
  }, LNB_POLL_MS);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.lnb && state.lnbGame?.status !== 'final') lnbRefresh();
});

async function linkGame(id, label = '') {
  state.lnb = { id: String(id), label };
  state.lnbGame = null;
  store.set('lnb', state.lnb);
  $('#account-dialog').close();
  renderLnb();
  lnbStartPolling();
}

$('#lnb-unlink').addEventListener('click', () => {
  clearInterval(lnbTimer);
  state.lnb = null;
  state.lnbGame = null;
  state.lnbError = null;
  store.set('lnb', null);
  renderLnb();
  toast('Jogo desvinculado. O placar volta a ser manual.');
});
$('#lnb-refresh').addEventListener('click', lnbRefresh);

$('#lnb-link').addEventListener('click', async () => {
  openDialog('Vincular jogo da LNB', `
    <p class="small" style="color:var(--muted);margin-top:0">O placar passa a ser atualizado sozinho a cada 30 segundos.</p>
    <ul id="lnb-games" class="game-list"><li class="small" style="color:var(--muted)">Carregando jogos de hoje…</li></ul>
    <p class="small" style="color:var(--muted)">Ou cole o link da página do jogo no site da LNB:</p>
    <div class="paste-row">
      <input id="lnb-input" type="url" inputmode="url" placeholder="https://lnb.com.br/partidas/…" aria-label="Link do jogo na LNB">
      <button type="button" id="lnb-go" class="ghost small">Vincular</button>
    </div>
    <p id="lnb-err" class="error"></p>`);

  $('#lnb-go').onclick = async () => {
    $('#lnb-err').textContent = '';
    try {
      const { id } = await api('/api/lnb/resolve', { input: $('#lnb-input').value });
      linkGame(id);
    } catch (err) { $('#lnb-err').textContent = err.message; }
  };

  try {
    const { games } = await api('/api/lnb/today');
    const list = $('#lnb-games');
    if (!games.length) { list.innerHTML = '<li class="small" style="color:var(--muted)">Nenhum jogo hoje na LNB.</li>'; return; }
    list.innerHTML = games.map((g) => {
      const score = g.status === 'scheduled' ? g.start : `${g.homeScore} x ${g.awayScore}`;
      const st = g.status === 'live' ? `● ${g.label} ${g.clock}` : g.status === 'final' ? 'Encerrado' : 'Hoje';
      return `<li><button type="button" data-id="${esc(g.id)}" data-label="${esc(`${g.home} x ${g.away}`)}">
        <strong>${esc(g.home)} ${esc(score)} ${esc(g.away)}</strong>
        <span class="st ${g.status === 'live' ? 'live' : ''}">${esc(st)}</span></button></li>`;
    }).join('');
    list.onclick = (e) => {
      const b = e.target.closest('button[data-id]');
      if (b) linkGame(b.dataset.id, b.dataset.label);
    };
  } catch (err) {
    $('#lnb-games').innerHTML = `<li class="error">${esc(err.message)}</li>`;
  }
});

// Textos montados com os dados reais do jogo.
function lnbSnippet(kind) {
  const g = state.lnbGame;
  if (!g) return '';
  const H = g.home.short;
  const A = g.away.short;
  const fmt = (list, unit) => list.map((p) => `${p.name} ${p.value}${unit}`).join(', ');
  switch (kind) {
    case 'parciais': {
      const qs = g.quarters.map((q) => `${q.home}-${q.away}`).join(' | ');
      return `📊 Parciais (${H} x ${A}): ${qs}\n`;
    }
    case 'cestinhas': {
      const h = g.leaders.home.pts[0];
      const a = g.leaders.away.pts[0];
      const parts = [h && `${h.name} (${H}) ${h.value} pts`, a && `${a.name} (${A}) ${a.value} pts`].filter(Boolean);
      return parts.length ? `🏆 Cestinhas: ${parts.join(' e ')}\n` : '';
    }
    case 'destaques': {
      const line = (side, short) => {
        const L = g.leaders[side];
        const bits = [
          L.pts[0] && `${L.pts[0].name} ${L.pts[0].value} pts`,
          L.reb[0] && `${L.reb[0].name} ${L.reb[0].value} reb`,
          L.ast[0] && `${L.ast[0].name} ${L.ast[0].value} ast`,
        ].filter(Boolean);
        return `${short}: ${bits.join(' · ')}`;
      };
      return `⭐ Destaques\n${line('home', H)}\n${line('away', A)}\n`;
    }
    case 'quarto': {
      const q = g.quarterLeaders.period;
      const part = g.quarters.find((x) => x.q === q);
      const name = q > 4 ? 'da prorrogação' : `do ${ORD(q)} quarto`;
      const head = part ? `${H} ${part.home} x ${part.away} ${A}` : `${H} x ${A}`;
      const h = fmt(g.quarterLeaders.home, ' pts');
      const a = fmt(g.quarterLeaders.away, ' pts');
      return `⏱️ Parcial ${name}: ${head}\n${h ? `${H}: ${h}\n` : ''}${a ? `${A}: ${a}\n` : ''}`;
    }
    case 'ultima': {
      const p = g.plays.find((x) => x.scoring);
      if (!p) return '';
      const q = p.period > 4 ? 'prorr.' : `${ORD(p.period)}Q`;
      return `🏀 ${p.text} (${p.team ? `${p.team} · ` : ''}${p.score}, ${q} ${p.clock})\n`;
    }
    default:
      return '';
  }
}

$('#lnb-chips').addEventListener('click', (e) => {
  const kind = e.target.closest('button')?.dataset.lnb;
  if (!kind) return;
  const text = lnbSnippet(kind);
  if (text) insertAtCursor(text);
  else toast('Ainda não há dados para esse atalho.');
});

// ---------- Texto e contadores ----------
const tagsInput = $('#tags');
const autoTags = $('#auto-tags');
tagsInput.value = store.get('tags', '#NBA #NasQuadras');
autoTags.checked = store.get('autoTags', true);
tagsInput.addEventListener('input', () => { store.set('tags', tagsInput.value); onTextChange(); });
autoTags.addEventListener('change', () => { store.set('autoTags', autoTags.checked); onTextChange(); });

function finalText() {
  const body = $('#text').value.trim();
  const tags = tagsInput.value.trim();
  return autoTags.checked && tags ? `${body}\n\n${tags}`.trim() : body;
}

function onTextChange() {
  store.set('draft', $('#text').value);
  const n = glen(finalText());
  const ct = $('#count-threads');
  ct.textContent = `Threads ${n}/${THREADS_MAX}`;
  ct.className = `count ${n > THREADS_MAX ? 'over' : n > THREADS_MAX - 40 ? 'near' : ''}`;
  const cb = $('#count-bluesky');
  if (n > BLUESKY_MAX) {
    const parts = Math.ceil(n / (BLUESKY_MAX - 20));
    cb.textContent = `Bluesky ${n}/${BLUESKY_MAX} · fio de ~${parts}`;
    cb.className = 'count thread';
  } else {
    cb.textContent = `Bluesky ${n}/${BLUESKY_MAX}`;
    cb.className = `count ${n > BLUESKY_MAX - 30 ? 'near' : ''}`;
  }
  const nx = xLength(finalText());
  const cx = $('#count-x');
  cx.textContent = `X ${nx}/${X_MAX}`;
  cx.className = `count ${nx > X_MAX ? 'over' : nx > X_MAX - 20 ? 'near' : ''}`;
  renderWarnings();
}

// ---------- Copiar (para colar no X/Twitter) ----------
/** Contagem do X: links valem 23 caracteres e emojis valem 2. */
function xLength(text) {
  const withoutUrls = text.replace(/https?:\/\/\S+/g, '');
  const urls = (text.match(/https?:\/\/\S+/g) || []).length;
  let n = urls * 23;
  for (const { segment } of seg.segment(withoutUrls)) n += /\p{Extended_Pictographic}/u.test(segment) ? 2 : 1;
  return n;
}

let lastPublishedText = '';

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Alternativa para navegadores que bloqueiam a área de transferência.
    const tmp = document.createElement('textarea');
    tmp.value = text;
    tmp.setAttribute('readonly', '');
    tmp.style.position = 'fixed';
    tmp.style.opacity = '0';
    document.body.append(tmp);
    tmp.select();
    tmp.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    tmp.remove();
    return ok;
  }
}

$('#copy').addEventListener('click', async () => {
  // Sem texto na caixa (ex.: logo depois de publicar), copia o último post publicado.
  const text = finalText() || lastPublishedText;
  if (!text) return toast('Nada para copiar ainda.');
  if (!(await copyText(text))) return toast('Não consegui copiar. Selecione o texto e copie manualmente.');
  const btn = $('#copy');
  btn.classList.add('done');
  btn.textContent = '✓ Copiado';
  setTimeout(() => { btn.classList.remove('done'); btn.textContent = '📋 Copiar'; }, 1800);
  const nx = xLength(text);
  const extra = state.media.length ? ' Fotos e vídeos precisam ser anexados direto no X.' : '';
  toast(nx > X_MAX
    ? `Copiado, mas passa do limite do X (${nx}/${X_MAX}).${extra}`
    : `Copiado! Cole no X.${extra}`);
});
$('#text').value = store.get('draft', '');
$('#text').addEventListener('input', onTextChange);

function renderWarnings() {
  const w = [];
  const n = glen(finalText());
  const toThreads = $('#t-threads').checked;
  const toBsky = $('#t-bluesky').checked;
  const videos = state.media.filter((m) => m.kind === 'video').length;
  const images = state.media.length - videos;
  if (toThreads && n > THREADS_MAX) w.push(`Threads aceita até ${THREADS_MAX} caracteres.`);
  if (toThreads && state.media.length > 10) w.push('Threads aceita até 10 mídias por post.');
  if (toBsky && videos && state.media.length > 1) w.push('Bluesky: só o vídeo será enviado (1 vídeo por post, sem fotos junto).');
  if (toBsky && !videos && images > 4) w.push('Bluesky: só as 4 primeiras fotos serão enviadas.');
  if (state.media.some((m) => m.duration > 300)) w.push('Threads aceita vídeos de até 5 minutos.');
  const t = state.status?.threads;
  if (toThreads && threadOn() && t?.connected && !t.canReply) {
    w.push('Para o fio no Threads, toque em "Threads" no topo, desconecte e conecte de novo (nova permissão de respostas). Até lá, o Threads recebe posts soltos.');
  }
  if (threadOn() && toThreads !== toBsky) w.push('O fio só avança na rede selecionada.');
  $('#warnings').textContent = w.join(' ');
}
$('#t-threads').addEventListener('change', renderWarnings);
$('#t-bluesky').addEventListener('change', renderWarnings);

// ---------- Mídia ----------
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Abre a imagem por createImageBitmap ou, se o navegador não conseguir, por <img>.
async function decodeImage(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight, source: img };
  }
}

function toJpeg(src, w, h, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // fundo branco para PNG transparente
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  return new Promise((resolve, reject) => canvas.toBlob(
    (b) => (b ? resolve(b) : reject(new Error('Falha ao converter a imagem.'))), 'image/jpeg', quality,
  ));
}

async function compressImage(file) {
  const bmp = await decodeImage(file);
  const src = bmp.source || bmp;
  if (file.type === 'image/gif' && file.size <= IMAGE_TARGET_BYTES) {
    return { blob: file, width: bmp.width, height: bmp.height, mime: 'image/gif' };
  }
  let scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bmp.width, bmp.height));
  let quality = 0.9;
  for (let attempt = 0; attempt < 8; attempt++) {
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const blob = await toJpeg(src, w, h, quality);
    if (blob.size <= IMAGE_TARGET_BYTES) return { blob, width: w, height: h, mime: 'image/jpeg' };
    if (quality > 0.65) quality -= 0.1; else scale *= 0.8;
  }
  throw new Error('Não consegui reduzir a imagem o suficiente.');
}

function videoMeta(file) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => resolve({ width: v.videoWidth, height: v.videoHeight, duration: v.duration, url: v.src });
    v.onerror = () => resolve({ width: 0, height: 0, duration: 0, url: v.src });
    v.src = URL.createObjectURL(file);
  });
}

function uploadBlob(item, blob, mime) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', '/api/media');
    xhr.setRequestHeader('Content-Type', mime);
    xhr.setRequestHeader('X-NQ', '1');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) { item.progress = e.loaded / e.total; renderMedia(); } };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* resposta vazia */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || `Erro ${xhr.status} no envio`));
    };
    xhr.onerror = () => reject(new Error('Falha de rede no envio.'));
    xhr.send(blob);
  });
}

async function addFile(file) {
  const kind = file.type.startsWith('video/') ? 'video' : 'image';
  const item = { id: crypto.randomUUID(), kind, alt: '', status: 'preparing', progress: 0, preview: '' };
  state.media.push(item);
  renderMedia();
  try {
    let blob = file;
    let mime = file.type;
    if (kind === 'image') {
      const r = await compressImage(file);
      Object.assign(item, { width: r.width, height: r.height });
      blob = r.blob; mime = r.mime;
      item.preview = URL.createObjectURL(blob);
    } else {
      if (file.size > VIDEO_MAX_BYTES) throw new Error('Vídeo maior que 100 MB.');
      if (!['video/mp4', 'video/quicktime', 'video/webm'].includes(mime)) throw new Error('Use vídeo MP4 ou MOV.');
      const meta = await videoMeta(file);
      Object.assign(item, { width: meta.width, height: meta.height, duration: meta.duration, preview: meta.url });
    }
    item.mime = mime;
    item.status = 'uploading';
    renderMedia();
    const { key } = await uploadBlob(item, blob, mime);
    item.key = key;
    item.status = 'ready';
  } catch (err) {
    item.status = 'failed';
    item.error = err.message;
    toast(err.message);
  }
  renderMedia();
  renderWarnings();
}

function renderMedia() {
  const grid = $('#media');
  grid.innerHTML = state.media.map((m) => `
    <div class="thumb ${m.status === 'failed' ? 'failed' : ''}" data-id="${m.id}">
      ${m.preview ? (m.kind === 'video'
        ? `<video src="${m.preview}" muted playsinline preload="metadata"></video>`
        : `<img src="${m.preview}" alt="">`) : '<div style="aspect-ratio:1"></div>'}
      <span class="badge">${m.status === 'ready' ? (m.kind === 'video' ? '▶ vídeo' : 'ok') : m.status === 'failed' ? 'erro' : m.status === 'uploading' ? `${Math.round(m.progress * 100)}%` : '…'}</span>
      ${m.status === 'uploading' ? `<span class="bar" style="width:${Math.round(m.progress * 100)}%"></span>` : ''}
      <button type="button" class="rm" aria-label="Remover">×</button>
      <input class="alt" placeholder="Descrição (alt)" value="${esc(m.alt)}" aria-label="Texto alternativo">
    </div>`).join('');
}

$('#media').addEventListener('click', (e) => {
  if (!e.target.classList.contains('rm')) return;
  const id = e.target.closest('.thumb').dataset.id;
  state.media = state.media.filter((m) => m.id !== id);
  renderMedia(); renderWarnings();
});
$('#media').addEventListener('input', (e) => {
  if (!e.target.classList.contains('alt')) return;
  const m = state.media.find((x) => x.id === e.target.closest('.thumb').dataset.id);
  if (m) m.alt = e.target.value;
});

$('#file').addEventListener('change', (e) => {
  for (const f of e.target.files) addFile(f);
  e.target.value = '';
});

// ---------- Publicação ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitThreads(ids, onTick) {
  const started = Date.now();
  while (Date.now() - started < 5 * 60 * 1000) {
    const { items } = await api('/api/threads/status', { ids });
    const bad = items.find((i) => i.status === 'ERROR' || i.status === 'EXPIRED');
    if (bad) throw new Error(`Threads recusou a mídia: ${bad.error || bad.status}`);
    if (items.every((i) => i.status === 'FINISHED')) return;
    onTick?.();
    await sleep(2500);
  }
  throw new Error('Threads demorou demais para processar a mídia.');
}

async function postThreads(text, media, step, thread) {
  step(thread ? 'Respondendo no fio…' : 'Criando post…');
  const r = await api('/api/threads/containers', { text, media, thread });
  let containerId = r.containerId;
  if (r.itemIds.length) {
    step('Processando mídias…');
    await waitThreads(r.itemIds);
    containerId = (await api('/api/threads/carousel', { text, itemIds: r.itemIds, thread })).containerId;
  }
  step(media.some((m) => m.kind === 'video') ? 'Processando vídeo…' : 'Preparando…');
  await waitThreads([containerId]);
  step('Publicando…');
  return api('/api/threads/publish', { containerId, thread });
}

function progressRow(name) {
  const el = document.createElement('div');
  el.className = 'step';
  el.innerHTML = `<span>${name}</span><span class="msg">…</span>`;
  $('#progress').append(el);
  return {
    set: (msg) => { el.querySelector('.msg').textContent = msg; },
    ok: (url) => { el.classList.add('ok'); el.querySelector('.msg').innerHTML = url ? `<a href="${esc(url)}" target="_blank" rel="noopener">Publicado ↗</a>` : 'Publicado'; },
    bad: (msg) => { el.classList.add('bad'); el.querySelector('.msg').textContent = msg; },
  };
}

$('#publish').addEventListener('click', async () => {
  if (state.busy) return;
  const text = finalText();
  const toThreads = $('#t-threads').checked;
  const toBsky = $('#t-bluesky').checked;
  if (!toThreads && !toBsky) return toast('Escolha pelo menos uma rede.');
  if (state.media.some((m) => m.status === 'uploading' || m.status === 'preparing')) return toast('Aguarde o envio das mídias terminar.');
  if (state.media.some((m) => m.status === 'failed')) return toast('Remova as mídias com erro antes de publicar.');
  const media = state.media.map(({ key, kind, mime, width, height, alt }) => ({ key, kind, mime, width, height, alt }));
  if (!text && !media.length) return toast('Escreva algo ou anexe uma mídia.');
  if (toThreads && glen(text) > THREADS_MAX) return toast(`Texto passa de ${THREADS_MAX} caracteres para o Threads.`);

  state.busy = true;
  $('#publish').disabled = true;
  $('#progress').innerHTML = '';
  const result = { text };
  const jobs = [];

  const inThread = threadOn();
  const threadsInThread = inThread && state.status?.threads?.canReply !== false;

  if (toThreads) {
    const row = progressRow('Threads');
    jobs.push(postThreads(text, media, row.set, threadsInThread)
      .then((r) => { row.ok(r.url); result.threads = r.url || 'ok'; })
      .catch((err) => { row.bad(err.message); result.threadsError = err.message; }));
  }
  if (toBsky) {
    const row = progressRow('Bluesky');
    row.set(media.length ? 'Enviando mídia…' : 'Publicando…');
    jobs.push(api('/api/bluesky/post', { text, media, thread: inThread })
      .then((r) => { row.ok(r.url); result.bluesky = r.url; if (r.note) toast(r.note); })
      .catch((err) => { row.bad(err.message); result.blueskyError = err.message; }));
  }

  await Promise.all(jobs);
  state.busy = false;
  $('#publish').disabled = false;

  const anyOk = result.threads || result.bluesky;
  const anyFail = result.threadsError || result.blueskyError;
  if (anyOk) {
    api('/api/history', { text: text.slice(0, 200), threads: result.threads, bluesky: result.bluesky })
      .then((h) => renderHistory(h.items)).catch(() => {});
    if (inThread) refreshThread().catch(() => {});
  }
  if (anyOk && !anyFail) {
    lastPublishedText = text;
    $('#text').value = '';
    state.media = [];
    renderMedia();
    onTextChange();
    navigator.vibrate?.([20, 40, 20]);
    toast('Publicado!');
  }
});

// ---------- Histórico ----------
function renderHistory(items = []) {
  $('#history').innerHTML = items.map((h) => `
    <li>${esc(h.text)}
      <div class="meta">
        <span>${new Date(h.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
        ${h.threads && h.threads !== 'ok' ? `<a href="${esc(h.threads)}" target="_blank" rel="noopener">Threads ↗</a>` : h.threads ? '<span>Threads ✓</span>' : ''}
        ${h.bluesky ? `<a href="${esc(h.bluesky)}" target="_blank" rel="noopener">Bluesky ↗</a>` : ''}
      </div>
    </li>`).join('');
}

// ---------- Início ----------
async function boot() {
  try {
    await refreshStatus();
  } catch (err) {
    // 401 já abre o login; outros erros (ex.: app sem senha configurada) aparecem lá também.
    showLogin();
    if (err.message !== 'Sessão expirada.') $('#login-error').textContent = err.message;
    return;
  }
  showApp();
  renderGame();
  onTextChange();
  renderLnb();
  lnbStartPolling();
  api('/api/history').then((h) => renderHistory(h.items)).catch(() => {});

  const q = new URLSearchParams(location.search);
  if (q.has('threads')) {
    const r = q.get('threads');
    toast(r === 'ok' ? 'Threads conectado!' : `Threads: ${q.get('msg') || r}`, 6000);
    history.replaceState(null, '', '/');
  }
}

boot();
