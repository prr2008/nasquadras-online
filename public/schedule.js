// Agendamento de posts do Ao vivo: horário, fio da cobertura e X pelo Buffer.
// Usa as funções do app expostas em window.NQ (app.js).

const $ = (sel) => document.querySelector(sel);
const NQ = () => window.NQ;

let rows = { pending: [], done: [] };
let bufferOn = false;
let editingId = null;

const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtWhen = (ms) => new Date(ms).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const MODE = { start: '🧵 abre a cobertura', reply: '↳ no fio', none: 'solto' };

function targets() {
  return { threads: $('#t-threads').checked, bluesky: $('#t-bluesky').checked, site: $('#t-site').checked };
}

function renderTargets() {
  const t = targets();
  const names = [t.threads && 'Threads', t.bluesky && 'Bluesky', t.site && 'Site', NQ().xOn() && 'X (Buffer)'].filter(Boolean);
  $('#sched-targets').textContent = names.join(', ') || 'nenhum';
  $('#sched-x-note').hidden = !NQ().xOn();
}

function renderThreadNote() {
  const mode = $('#sched-thread').value;
  $('#sched-title-row').hidden = mode !== 'start';
  $('#sched-thread-note').textContent = {
    start: 'No horário, este post abre o fio da cobertura no Threads e no Bluesky e cria a página do jogo no site. Se houver outra cobertura ativa, ela é encerrada.',
    reply: 'Sai como resposta no fio da cobertura ativa no horário (se não houver cobertura, sai solto).',
    none: 'Sai como post avulso, fora do fio.',
  }[mode];
}

function defaultTitle() {
  const g = NQ().state.game || {};
  return g.away || g.home ? `${g.away || 'Mandante'} x ${g.home || 'Visitante'}` : '';
}

function openPanel(row = null) {
  editingId = row?.id || null;
  $('#sched-heading').textContent = row ? 'Editar agendamento' : 'Agendar post';
  $('#sched-save').textContent = row ? 'Salvar alterações' : 'Agendar';
  const last = rows.pending.filter((r) => r.id !== editingId).at(-1);
  let when = row?.run_at;
  // Sem horário: 1 minuto depois do último agendado, ou daqui a ~30 min (múltiplo de 5).
  if (!when) when = last ? last.run_at + 60_000 : Math.ceil((Date.now() + 30 * 60_000) / 300_000) * 300_000;
  $('#sched-at').value = toLocalInput(when);
  const hasStart = rows.pending.some((r) => r.thread === 'start' && r.id !== editingId);
  $('#sched-thread').value = row?.thread || (hasStart ? 'reply' : 'start');
  $('#sched-title').value = row?.title || defaultTitle();
  renderThreadNote();
  renderTargets();
  $('#sched-panel').hidden = false;
  $('#sched-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closePanel() {
  $('#sched-panel').hidden = true;
  editingId = null;
}

$('#sched-open').addEventListener('click', () => {
  if (!$('#sched-panel').hidden && !editingId) return closePanel();
  openPanel();
});
$('#sched-close').addEventListener('click', closePanel);
$('#sched-thread').addEventListener('change', renderThreadNote);
['#t-threads', '#t-bluesky', '#t-site', '#t-x'].forEach((id) => $(id).addEventListener('change', renderTargets));
$('#sched-save').addEventListener('click', async () => {
  const st = NQ().state;
  if (st.media.some((m) => m.status === 'uploading' || m.status === 'preparing')) return NQ().toast('Aguarde o envio das mídias terminar.');
  if (st.media.some((m) => m.status === 'failed')) return NQ().toast('Remova as mídias com erro antes de agendar.');
  const runAt = new Date($('#sched-at').value).getTime();
  if (!Number.isFinite(runAt)) return NQ().toast('Escolha a data e a hora.');
  const xOn = NQ().xOn();
  const xText = NQ().xText();
  if (xOn && NQ().xLength(xText) > NQ().X_MAX) return NQ().toast(`A versão para o X passa de ${NQ().X_MAX} caracteres.`);
  const payload = {
    runAt,
    text: NQ().finalText(),
    media: st.media.map(({ key, kind, mime, width, height, alt }) => ({ key, kind, mime, width, height, alt })),
    targets: targets(),
    thread: $('#sched-thread').value,
    title: $('#sched-title').value.trim(),
    lnbId: st.lnb?.id || null,
    x: xOn ? { text: xText } : null,
  };
  $('#sched-save').disabled = true;
  try {
    const saved = editingId
      ? await NQ().api(`/api/schedule/${editingId}`, payload, 'PUT')
      : await NQ().api('/api/schedule', payload);
    closePanel();
    $('#text').value = '';
    st.media = [];
    NQ().renderMedia();
    NQ().resetX();
    NQ().onTextChange();
    NQ().toast(`Agendado para ${fmtWhen(saved.run_at)}.${saved.buffer_id ? ' O X foi para a fila do Buffer.' : ''}`, 5000);
    await refresh();
  } catch (err) {
    NQ().toast(err.message, 6000);
  } finally {
    $('#sched-save').disabled = false;
  }
});

// ---------- Lista ----------

function dests(r) {
  const t = r.targets || {};
  return [t.threads && 'Threads', t.bluesky && 'Bluesky', t.site && 'Site', r.x_text != null && 'X'].filter(Boolean).join(' · ');
}

function resultLinks(r) {
  const x = r.result || {};
  const esc = NQ().esc;
  const parts = [];
  if (x.threads) parts.push(x.threads !== 'ok' ? `<a href="${esc(x.threads)}" target="_blank" rel="noopener">Threads ↗</a>` : 'Threads ✓');
  if (x.bluesky) parts.push(`<a href="${esc(x.bluesky)}" target="_blank" rel="noopener">Bluesky ↗</a>`);
  if (x.site) parts.push(`<a href="${esc(x.site)}" target="_blank" rel="noopener">Site ↗</a>`);
  if (r.buffer_id) parts.push('X pelo Buffer');
  const errs = ['threads', 'bluesky', 'site'].filter((k) => x[`${k}Error`]).map((k) => `${k}: ${x[`${k}Error`]}`);
  if (x.error) errs.push(x.error);
  return parts.join(' · ') + (errs.length ? `<span class="sched-err">Falhou — ${esc(errs.join('; '))}</span>` : '');
}

function render() {
  const esc = NQ().esc;
  const all = [...rows.pending, ...rows.done];
  $('#sched-wrap').hidden = !all.length;
  $('#sched-list').innerHTML = all.map((r) => {
    const pending = r.status === 'pending';
    const label = { pending: '', sending: 'Publicando…', sent: 'Publicado', partial: 'Publicado em parte', error: 'Erro' }[r.status] || '';
    const media = r.media?.length ? ` · ${r.media.length} ${r.media.length === 1 ? 'mídia' : 'mídias'}` : '';
    return `<li class="sched-item ${r.status}" data-id="${r.id}">
      <div class="sched-when"><strong>${esc(fmtWhen(r.run_at))}</strong> <span>${MODE[r.thread] || ''}${r.thread === 'start' && r.title ? ` · ${esc(r.title)}` : ''}</span></div>
      <div class="sched-text">${esc(r.text || r.x_text || '(só mídia)')}</div>
      <div class="meta"><span>${esc(dests(r))}${media}</span>${label ? `<span class="badge ${r.status === 'sent' ? 'published' : r.status === 'pending' ? '' : 'draft'}">${label}</span>` : ''}</div>
      ${pending ? '' : `<div class="meta">${resultLinks(r)}</div>`}
      <div class="sched-actions">
        ${pending ? `<button type="button" class="link small" data-act="now">Publicar agora</button>
          <button type="button" class="link small" data-act="edit">Editar</button>
          <button type="button" class="link small danger" data-act="cancel">Cancelar</button>`
        : r.status === 'sending' ? '' : '<button type="button" class="link small" data-act="cancel">Tirar da lista</button>'}
      </div>
    </li>`;
  }).join('');
}

let lastPendingDue = 0;
async function refresh() {
  const data = await NQ().api('/api/schedule');
  const hadDue = rows.pending.some((r) => r.run_at <= Date.now());
  rows = { pending: data.pending, done: data.done };
  bufferOn = data.buffer;
  if (!bufferChecked) { NQ().state.buffer = bufferOn; NQ().renderX(); }
  render();
  // Algo saiu desde a última olhada: atualiza o fio e o histórico.
  if (hadDue || data.done.some((r) => r.updated_at > lastPendingDue)) {
    NQ().refreshThread().catch(() => {});
    NQ().api('/api/history').then((h) => NQ().renderHistory(h.items)).catch(() => {});
  }
  lastPendingDue = Math.max(lastPendingDue, ...data.done.map((r) => r.updated_at), 0);
}

$('#sched-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = Number(btn.closest('li').dataset.id);
  const row = [...rows.pending, ...rows.done].find((r) => r.id === id);
  const act = btn.dataset.act;
  try {
    if (act === 'cancel') {
      const pending = row?.status === 'pending';
      if (pending && !confirm(`Cancelar o post de ${fmtWhen(row.run_at)}?${row.buffer_id ? ' Ele também sai da fila do Buffer.' : ''}`)) return;
      const r = await NQ().api(`/api/schedule/${id}`, undefined, 'DELETE');
      if (r.note) NQ().toast(r.note, 7000); else if (pending) NQ().toast('Agendamento cancelado.');
    } else if (act === 'now') {
      if (!confirm('Publicar este post agora?')) return;
      btn.disabled = true;
      NQ().toast('Publicando…');
      const r = await NQ().api(`/api/schedule/${id}/now`, {});
      const xNote = row?.buffer_id ? ' O X continua no horário marcado no Buffer.' : '';
      NQ().toast(r.status === 'sent' ? `Publicado!${xNote}` : `Publicado com falhas: veja na lista.${xNote}`, 6000);
    } else if (act === 'edit') {
      const st = NQ().state;
      if (($('#text').value.trim() || st.media.length) && !confirm('Substituir o texto e as mídias da caixa pelo post agendado?')) return;
      // Separa as hashtags fixas, se o texto terminar com elas.
      const tags = $('#tags').value.trim();
      let text = row.text;
      if ($('#auto-tags').checked && tags && text.endsWith(tags)) text = text.slice(0, -tags.length).trim();
      else if ($('#auto-tags').checked) { $('#auto-tags').checked = false; $('#auto-tags').dispatchEvent(new Event('change')); }
      $('#text').value = text;
      st.media = (row.media || []).map((m) => ({ ...m, id: crypto.randomUUID(), status: 'ready', progress: 1, preview: `/m/${m.key}` }));
      $('#t-threads').checked = !!row.targets.threads;
      $('#t-bluesky').checked = !!row.targets.bluesky;
      $('#t-site').checked = !!row.targets.site;
      $('#t-x').checked = row.x_text != null;
      NQ().renderMedia(); NQ().onTextChange();
      // Versão do X diferente do texto do post: abre a caixa com ela.
      if (row.x_text != null && row.x_text !== row.text) { $('#x-text').value = row.x_text; $('#x-text').dispatchEvent(new Event('input')); }
      NQ().renderWarnings();
      openPanel(row);
      return;
    }
  } catch (err) {
    NQ().toast(err.message, 6000);
  }
  await refresh().catch(() => {});
});

// Confere a conexão com o Buffer uma vez por sessão.
let bufferChecked = false;
async function checkBuffer() {
  if (bufferChecked || !bufferOn) return;
  bufferChecked = true;
  const r = await NQ().api('/api/buffer/check');
  NQ().state.buffer = r.ok;
  NQ().renderX();
  NQ().renderWarnings();
  if (!r.ok) NQ().toast(`Buffer: ${r.error}`, 7000);
}

window.addEventListener('nq:ready', () => {
  refresh().then(checkBuffer).catch(() => {});
  setInterval(() => { if (!document.hidden && !$('#app').hidden) refresh().catch(() => {}); }, 30_000);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && window.NQ) refresh().catch(() => {}); });
