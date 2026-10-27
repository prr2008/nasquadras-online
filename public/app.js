// Nas Quadras Online — interface de publicação ao vivo.

const $ = (sel) => document.querySelector(sel);
const THREADS_MAX = 500;
const BLUESKY_MAX = 300;
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
}

// ---------- Placar ----------
function renderGame() {
  const g = state.game;
  $('#away').value = g.away; $('#home').value = g.home;
  $('#sa').textContent = g.sa; $('#sh').textContent = g.sh;
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
  return `🏀 ${g.away || 'Visitante'} ${g.sa} x ${g.sh} ${g.home || 'Mandante'} | ${PERIOD_LABEL[g.period]}`;
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
  ct.textContent = `${n}/${THREADS_MAX}`;
  ct.className = `count ${n > THREADS_MAX ? 'over' : n > THREADS_MAX - 40 ? 'near' : ''}`;
  const cb = $('#count-bluesky');
  if (n > BLUESKY_MAX) {
    const parts = Math.ceil(n / (BLUESKY_MAX - 20));
    cb.textContent = `${n}/${BLUESKY_MAX} · fio de ~${parts}`;
    cb.className = 'count thread';
  } else {
    cb.textContent = `${n}/${BLUESKY_MAX}`;
    cb.className = `count ${n > BLUESKY_MAX - 30 ? 'near' : ''}`;
  }
  renderWarnings();
}
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

async function postThreads(text, media, step) {
  step('Criando post…');
  const r = await api('/api/threads/containers', { text, media });
  let containerId = r.containerId;
  if (r.itemIds.length) {
    step('Processando mídias…');
    await waitThreads(r.itemIds);
    containerId = (await api('/api/threads/carousel', { text, itemIds: r.itemIds })).containerId;
  }
  step(media.some((m) => m.kind === 'video') ? 'Processando vídeo…' : 'Preparando…');
  await waitThreads([containerId]);
  step('Publicando…');
  return api('/api/threads/publish', { containerId });
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

  if (toThreads) {
    const row = progressRow('Threads');
    jobs.push(postThreads(text, media, row.set)
      .then((r) => { row.ok(r.url); result.threads = r.url || 'ok'; })
      .catch((err) => { row.bad(err.message); result.threadsError = err.message; }));
  }
  if (toBsky) {
    const row = progressRow('Bluesky');
    row.set(media.length ? 'Enviando mídia…' : 'Publicando…');
    jobs.push(api('/api/bluesky/post', { text, media })
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
  }
  if (anyOk && !anyFail) {
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
  api('/api/history').then((h) => renderHistory(h.items)).catch(() => {});

  const q = new URLSearchParams(location.search);
  if (q.has('threads')) {
    const r = q.get('threads');
    toast(r === 'ok' ? 'Threads conectado!' : `Threads: ${q.get('msg') || r}`, 6000);
    history.replaceState(null, '', '/');
  }
}

boot();
