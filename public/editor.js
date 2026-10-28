// Editor visual do Blog e das páginas fixas do site (usa o Quill, incluído em /vendor/quill).

const $ = (sel) => document.querySelector(sel);
const NQ = () => window.NQ;
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const siteOrigin = () => (location.hostname === 'app.nasquadras.online' ? 'https://nasquadras.online' : location.origin);

// ---------- Navegação entre Ao vivo / Blog / Páginas ----------

function show(view) {
  for (const v of ['live', 'blog', 'coluna', 'pages']) $(`#view-${v}`).hidden = v !== view;
  document.querySelectorAll('.app-tabs a[data-view]').forEach((a) => a.classList.toggle('on', a.dataset.view === view));
}

async function route() {
  if ($('#app').hidden) return; // ainda no login
  const [section, arg] = location.hash.replace(/^#/, '').split('/');
  try {
    if (section === 'blog') {
      show('blog');
      if (arg === 'novo') return openArticle(null);
      if (arg) return openArticle(Number(arg));
      return listArticles();
    }
    if (section === 'coluna') {
      show('coluna');
      return listColumns();
    }
    if (section === 'paginas') {
      show('pages');
      if (arg) return openPage(arg);
      return listPages();
    }
    show('live');
  } catch (err) {
    NQ().toast(err.message);
  }
}

window.addEventListener('hashchange', () => {
  if (dirty() && !confirm('Há alterações não salvas. Sair mesmo assim?')) {
    history.pushState(null, '', lastHash);
    return;
  }
  lastHash = location.hash;
  route();
});
window.addEventListener('nq:ready', route);
window.addEventListener('beforeunload', (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });
let lastHash = location.hash;

// ---------- Editor (Quill) ----------

const TOOLBAR = [
  [{ header: [2, 3, false] }],
  ['bold', 'italic', 'underline', 'strike'],
  ['link', 'blockquote'],
  [{ list: 'ordered' }, { list: 'bullet' }],
  ['image', 'video'],
  ['clean'],
];

/** Converte links comuns do YouTube, Spotify e Vimeo no endereço de incorporação. */
function toEmbed(url) {
  const s = String(url || '').trim();
  let m = s.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}`;
  if (/youtube(-nocookie)?\.com\/embed\//.test(s)) return s.split('?')[0];
  m = s.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(?:embed\/)?(episode|show|track|playlist|album)\/(\w+)/);
  if (m) return `https://open.spotify.com/embed/${m[1]}/${m[2]}`;
  m = s.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (m) return `https://player.vimeo.com/video/${m[1]}`;
  return null;
}

async function uploadImage(file) {
  const r = await NQ().compressImage(file);
  const res = await fetch('/api/media', {
    method: 'PUT',
    headers: { 'Content-Type': r.mime, 'X-NQ': '1' },
    body: r.blob,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Falha ao enviar a imagem.');
  return data.key;
}

function makeEditor(selector, placeholder) {
  const quill = new window.Quill(selector, {
    theme: 'snow',
    placeholder,
    modules: {
      toolbar: {
        container: TOOLBAR,
        handlers: {
          image() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = async () => {
              const file = input.files[0];
              if (!file) return;
              const range = quill.getSelection(true);
              NQ().toast('Enviando imagem…');
              try {
                const key = await uploadImage(file);
                quill.insertEmbed(range.index, 'image', `/m/${key}`, 'user');
                quill.setSelection(range.index + 1, 0);
              } catch (err) { NQ().toast(err.message); }
            };
            input.click();
          },
          video() {
            const url = prompt('Cole o link do YouTube, Spotify ou Vimeo:');
            if (!url) return;
            const embed = toEmbed(url);
            if (!embed) { NQ().toast('Link não reconhecido. Use YouTube, Spotify ou Vimeo.'); return; }
            const range = quill.getSelection(true);
            quill.insertEmbed(range.index, 'video', embed, 'user');
            quill.setSelection(range.index + 1, 0);
          },
        },
      },
    },
  });
  return quill;
}

const getHtml = (quill) => (quill.getLength() <= 1 ? '' : quill.getSemanticHTML());
function setHtml(quill, html) {
  quill.setContents([]);
  if (html) quill.clipboard.dangerouslyPasteHTML(0, html, 'silent');
  quill.history.clear();
}

// Títulos: campo que cresce com o texto e não aceita quebra de linha.
for (const id of ['#blog-title', '#page-title']) {
  const el = $(id);
  const fit = () => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; };
  el.addEventListener('input', () => { el.value = el.value.replace(/\n/g, ' '); fit(); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
  el.fit = fit;
}

// ---------- Blog ----------

let blogQuill = null;
let article = null;          // artigo aberto ({} para um novo)
let snapshot = '';           // estado salvo, para detectar alterações
let categories = [];

const formState = () => JSON.stringify({
  title: $('#blog-title').value, summary: $('#blog-summary').value, category: $('#blog-category').value,
  cover: article?.cover_key || null, body: blogQuill ? getHtml(blogQuill) : '',
});
const pageState = () => JSON.stringify({ title: $('#page-title').value, body: pageQuill ? getHtml(pageQuill) : '' });
function dirty() {
  if (!$('#blog-form').hidden && article) return formState() !== snapshot;
  if (!$('#page-form').hidden && page) return pageState() !== pageSnapshot;
  return false;
}

async function listArticles() {
  $('#blog-form').hidden = true;
  $('#blog-list-view').hidden = false;
  article = null;
  const data = await NQ().api('/api/blog');
  categories = data.categories;
  const list = $('#blog-list');
  list.innerHTML = data.articles.length ? data.articles.map((a) => `
    <li><a href="#blog/${a.id}">
      <strong>${NQ().esc(a.title)}</strong>
      <span class="meta"><span class="badge ${a.status}">${a.status === 'published' ? 'Publicado' : 'Rascunho'}</span>
      ${NQ().esc(a.category)} · ${fmtDate(a.published_at || a.updated_at)}</span>
    </a></li>`).join('') : '<li class="empty-item">Nenhum artigo ainda. Toque em "Novo artigo".</li>';
}

// ---------- Google Docs → blog ----------

async function gdocsStatus() {
  const st = await NQ().api('/api/gdocs');
  const badge = $('#gdocs-state');
  badge.textContent = st.connected ? 'Conectado' : 'Não conectado';
  badge.className = `badge ${st.connected ? 'published' : ''}`;
  badge.title = st.connected && st.lastUsed ? `Último envio: ${new Date(st.lastUsed).toLocaleString('pt-BR')}` : '';
  $('#gdocs-revoke').hidden = !st.connected;
  $('#gdocs-token').textContent = st.connected ? 'Gerar novo código (o atual deixa de valer)' : 'Gerar código de conexão';
}

// O script é baixado ao abrir o painel, para a cópia acontecer direto no toque
// (o iPhone só deixa copiar logo depois do toque).
let gdocsScript = null;
const loadScript = () => fetch('/gdocs/NasQuadras.js', { cache: 'no-store' })
  .then((r) => { if (!r.ok) throw new Error('Não consegui carregar o script.'); return r.text(); })
  .then((t) => { gdocsScript = t; return t; });

$('#gdocs').addEventListener('toggle', () => {
  if (!$('#gdocs').open) return;
  gdocsStatus().catch((e) => NQ().toast(e.message));
  if (!gdocsScript) loadScript().catch(() => {});
});

$('#gdocs-copy-script').addEventListener('click', async () => {
  try {
    const text = gdocsScript || await loadScript();
    NQ().toast((await NQ().copyText(text)) ? 'Script copiado. Cole no Apps Script.' : 'Não consegui copiar. Tente de novo.');
  } catch (err) { NQ().toast(err.message); }
});

$('#gdocs-token').addEventListener('click', async () => {
  const connected = !$('#gdocs-revoke').hidden;
  if (connected && !confirm('Gerar um novo código? O documento-modelo e as cópias que usam o código atual vão parar de enviar até você colar o novo.')) return;
  try {
    const { code } = await NQ().api('/api/gdocs/token', {});
    const box = $('#gdocs-code');
    box.hidden = false;
    box.innerHTML = `<code>${NQ().esc(code)}</code><button type="button" class="ghost small">Copiar código</button>
      <small>Este código aparece só agora. Ele dá acesso para publicar no blog: não compartilhe. Se perder, gere outro.</small>`;
    box.querySelector('button').addEventListener('click', async () => {
      NQ().toast((await NQ().copyText(code)) ? 'Código copiado.' : 'Não consegui copiar. Selecione e copie.');
    });
    await NQ().copyText(code);
    await gdocsStatus();
  } catch (err) { NQ().toast(err.message); }
});

$('#gdocs-revoke').addEventListener('click', async () => {
  if (!confirm('Desconectar? O Google Docs deixa de conseguir enviar textos até você gerar um código novo.')) return;
  try {
    await NQ().api('/api/gdocs/token', undefined, 'DELETE');
    $('#gdocs-code').hidden = true;
    await gdocsStatus();
    NQ().toast('Google Docs desconectado.');
  } catch (err) { NQ().toast(err.message); }
});

$('#blog-new').addEventListener('click', () => { location.hash = '#blog/novo'; });
$('#blog-back').addEventListener('click', () => { location.hash = '#blog'; });

function renderCover() {
  const box = $('#blog-cover');
  if (article?.cover_key) {
    box.innerHTML = `<img src="/m/${NQ().esc(article.cover_key)}" alt="">`;
    $('#blog-cover-remove').hidden = false;
  } else {
    box.innerHTML = '<span>Sem capa</span>';
    $('#blog-cover-remove').hidden = true;
  }
}

function renderStatus() {
  const published = article?.status === 'published';
  $('#blog-status').textContent = article?.id ? (published ? 'Publicado' : 'Rascunho') : 'Novo';
  $('#blog-status').className = `badge ${published ? 'published' : 'draft'}`;
  $('#blog-publish').textContent = published ? 'Atualizar publicação' : 'Publicar';
  $('#blog-save').hidden = published; // publicado: alterações saem direto com "Atualizar"
  $('#blog-unpublish').hidden = !published;
  $('#blog-delete').hidden = !article?.id;
  $('#blog-announce').closest('label').hidden = published;
}

async function openArticle(id) {
  if (!categories.length) categories = (await NQ().api('/api/blog')).categories;
  $('#blog-list-view').hidden = true;
  $('#blog-form').hidden = false;
  $('#blog-category').innerHTML = categories.map((c) => `<option>${NQ().esc(c)}</option>`).join('');
  if (!blogQuill) blogQuill = makeEditor('#blog-editor', 'Escreva o texto aqui…');

  article = id ? await NQ().api(`/api/blog/${id}`) : { status: 'draft', category: 'NBB' };
  $('#blog-title').value = article.title || '';
  requestAnimationFrame(() => $('#blog-title').fit());
  $('#blog-summary').value = article.summary || '';
  $('#blog-category').value = article.category || 'NBB';
  setHtml(blogQuill, article.body_html || '');
  $('#blog-saved').textContent = article.updated_at ? `Salvo em ${new Date(article.updated_at).toLocaleString('pt-BR')}` : '';
  $('#blog-announce').checked = false;
  renderCover();
  renderStatus();
  snapshot = formState();

  // Cópia de segurança local: recupera texto que não chegou a ser salvo.
  const backup = localStorage.getItem(`nq:blog:${id || 'novo'}`);
  if (backup) {
    try {
      const b = JSON.parse(backup);
      if (b.state !== snapshot && confirm('Há uma versão não salva deste artigo neste aparelho. Recuperar?')) {
        const st = JSON.parse(b.state);
        $('#blog-title').value = st.title; $('#blog-summary').value = st.summary; $('#blog-category').value = st.category;
        article.cover_key = st.cover; renderCover();
        setHtml(blogQuill, st.body);
      }
    } catch { /* cópia inválida */ }
    localStorage.removeItem(`nq:blog:${id || 'novo'}`);
  }
  $('#blog-title').focus();
}

// Salva a cópia local a cada alteração (sem enviar ao servidor).
let backupTimer;
function backupLocal() {
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    if (!article || $('#blog-form').hidden) return;
    const st = formState();
    const key = `nq:blog:${article.id || 'novo'}`;
    if (st !== snapshot) localStorage.setItem(key, JSON.stringify({ state: st, at: Date.now() }));
    else localStorage.removeItem(key);
  }, 800);
}
['input', 'change'].forEach((ev) => $('#blog-form').addEventListener(ev, backupLocal));

$('#blog-cover-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  $('#blog-cover').innerHTML = '<span>Enviando…</span>';
  try {
    article.cover_key = await uploadImage(file);
  } catch (err) { NQ().toast(err.message); }
  renderCover();
  backupLocal();
});
$('#blog-cover-remove').addEventListener('click', () => { article.cover_key = null; renderCover(); backupLocal(); });

async function saveArticle(status) {
  const payload = {
    title: $('#blog-title').value.trim(),
    summary: $('#blog-summary').value.trim(),
    category: $('#blog-category').value,
    cover_key: article.cover_key || null,
    body_html: getHtml(blogQuill),
    status,
  };
  if (!payload.title) { NQ().toast('Dê um título ao artigo.'); $('#blog-title').focus(); return null; }
  const wasPublished = article.status === 'published';
  const saved = article.id
    ? await NQ().api(`/api/blog/${article.id}`, payload, 'PUT')
    : await NQ().api('/api/blog', payload);
  localStorage.removeItem(`nq:blog:${article.id || 'novo'}`);
  article = saved;
  snapshot = formState();
  $('#blog-saved').textContent = `Salvo em ${new Date(saved.updated_at).toLocaleString('pt-BR')}`;
  renderStatus();
  if (location.hash !== `#blog/${saved.id}`) { history.replaceState(null, '', `#blog/${saved.id}`); lastHash = location.hash; }
  return { saved, firstPublish: status === 'published' && !wasPublished };
}

async function announce(a) {
  return announceText(`📝 Novo no blog: ${a.title}\n\n${siteOrigin()}/blog/${a.slug}`);
}

async function announceText(text) {
  const st = NQ().state.status || {};
  const jobs = [];
  if (st.threads?.connected) jobs.push(NQ().postThreads(text, [], () => {}, false).then(() => 'Threads'));
  if (st.bluesky?.connected) jobs.push(NQ().api('/api/bluesky/post', { text, media: [], thread: false }).then(() => 'Bluesky'));
  const res = await Promise.allSettled(jobs);
  const ok = res.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const bad = res.filter((r) => r.status === 'rejected').map((r) => r.reason?.message);
  NQ().toast(ok.length ? `Divulgado no ${ok.join(' e ')}.${bad.length ? ` Falhou: ${bad.join('; ')}` : ''}` : `Não foi possível divulgar: ${bad.join('; ') || 'redes desconectadas'}`, 6000);
}

$('#blog-save').addEventListener('click', async () => {
  try { if (await saveArticle('draft')) NQ().toast('Rascunho salvo.'); } catch (err) { NQ().toast(err.message); }
});

$('#blog-publish').addEventListener('click', async () => {
  const republish = article.status === 'published';
  if (!republish && !confirm('Publicar este artigo no site agora?')) return;
  try {
    const r = await saveArticle('published');
    if (!r) return;
    NQ().toast(republish ? 'Publicação atualizada.' : 'Artigo publicado!');
    if (r.firstPublish && $('#blog-announce').checked) await announce(r.saved);
  } catch (err) { NQ().toast(err.message); }
});

$('#blog-unpublish').addEventListener('click', async () => {
  if (!confirm('Tirar o artigo do ar? Ele volta a ser rascunho e o link deixa de funcionar.')) return;
  try { await saveArticle('draft'); NQ().toast('Artigo voltou para rascunho.'); } catch (err) { NQ().toast(err.message); }
});

$('#blog-preview').addEventListener('click', async () => {
  // Abre a aba antes de salvar (navegadores bloqueiam janelas abertas depois de uma espera).
  const win = window.open('about:blank', '_blank');
  try {
    const r = await saveArticle(article.status === 'published' ? 'published' : 'draft');
    if (!r) { win?.close(); return; }
    if (win) win.location = `/blog/${r.saved.slug}`; else location.href = `/blog/${r.saved.slug}`;
  } catch (err) { win?.close(); NQ().toast(err.message); }
});

$('#blog-delete').addEventListener('click', async () => {
  if (!confirm(`Excluir "${article.title}"? Esta ação não pode ser desfeita.`)) return;
  try {
    await NQ().api(`/api/blog/${article.id}`, undefined, 'DELETE');
    snapshot = formState(); // evita o aviso de alterações
    article = null;
    NQ().toast('Artigo excluído.');
    location.hash = '#blog';
  } catch (err) { NQ().toast(err.message); }
});

// ---------- Páginas fixas ----------

let pageQuill = null;
let page = null;
let pageSnapshot = '';

async function listPages() {
  $('#page-form').hidden = true;
  $('#pages-list-view').hidden = false;
  page = null;
  const { pages } = await NQ().api('/api/pages');
  $('#pages-list').innerHTML = pages.map((p) => `
    <li><a href="#paginas/${p.slug}">
      <strong>${NQ().esc(p.title)}</strong>
      <span class="meta">${p.body_html ? `Atualizada em ${fmtDate(p.updated_at)}` : '<span class="badge draft">Vazia</span> mostra um texto provisório'}</span>
    </a></li>`).join('');
}

async function openPage(slug) {
  const { pages } = await NQ().api('/api/pages');
  page = pages.find((p) => p.slug === slug);
  if (!page) { location.hash = '#paginas'; return; }
  $('#pages-list-view').hidden = true;
  $('#page-form').hidden = false;
  if (!pageQuill) pageQuill = makeEditor('#page-editor', 'Escreva o conteúdo da página…');
  $('#page-title').value = page.title;
  requestAnimationFrame(() => $('#page-title').fit());
  setHtml(pageQuill, page.body_html || '');
  $('#page-view').href = `/${slug}`;
  $('#page-saved').textContent = page.updated_at ? `Salva em ${new Date(page.updated_at).toLocaleString('pt-BR')}` : '';
  pageSnapshot = pageState();
}

$('#page-back').addEventListener('click', () => { location.hash = '#paginas'; });
$('#page-save').addEventListener('click', async () => {
  try {
    page = await NQ().api(`/api/pages/${page.slug}`, { title: $('#page-title').value, body_html: getHtml(pageQuill) }, 'PUT');
    pageSnapshot = pageState();
    $('#page-saved').textContent = `Salva em ${new Date(page.updated_at).toLocaleString('pt-BR')}`;
    NQ().toast('Página salva.');
  } catch (err) { NQ().toast(err.message); }
});

// ---------- Coluna (links das colunas publicadas) ----------

let colEditing = null; // null = nova coluna; objeto = coluna existente em edição
let colPreview = null;

const toDateInput = (ms) => new Date(ms - 3 * 3600 * 1000).toISOString().slice(0, 10); // dia em Brasília
const fromDateInput = (v, keepMs) => {
  // Mantém o horário original quando o dia não mudou.
  if (keepMs && toDateInput(keepMs) === v) return keepMs;
  return Date.parse(`${v}T12:00:00-03:00`);
};

async function listColumns() {
  const { columns } = await NQ().api('/api/coluna');
  $('#col-list').innerHTML = columns.length ? columns.map((c) => `
    <li data-id="${c.id}">
      ${c.image_key ? `<img class="thumb-sm" src="/m/${NQ().esc(c.image_key)}" alt="">` : '<div class="thumb-sm"></div>'}
      <div class="info">
        <strong>${NQ().esc(c.title)}</strong>
        <span class="meta">${NQ().esc(c.source)} · ${fmtDate(c.published_at)}</span>
        <span class="actions">
          <a href="${NQ().esc(c.url)}" target="_blank" rel="noopener">Abrir ↗</a>
          <button type="button" data-act="edit">Editar</button>
          <button type="button" data-act="del">Remover</button>
        </span>
      </div>
    </li>`).join('') : '<li class="empty-item" style="display:block;background:none;border:0">Nenhuma coluna ainda. Cole o link de uma coluna acima.</li>';
  $('#col-list').columns = columns;
}

function fillColForm(d, { editing = false } = {}) {
  $('#col-form').hidden = false;
  $('#col-title').value = d.title || '';
  $('#col-summary').value = d.summary || '';
  $('#col-source').value = d.source || 'Jornal do Brasil';
  $('#col-date').value = toDateInput(d.published_at || Date.now());
  $('#col-link').href = d.url;
  $('#col-link').textContent = d.url.replace(/^https?:\/\/(www\.)?/, '');
  const img = d.image_key ? `/m/${d.image_key}` : d.image_url;
  $('#col-img').innerHTML = img ? `<img src="${NQ().esc(img)}" alt="">` : '<span>Sem foto</span>';
  $('#col-save').textContent = editing ? 'Salvar alterações' : 'Adicionar à Coluna';
  $('#col-announce-row').hidden = editing;
  $('#col-announce').checked = false;
  $('#col-title').focus();
}

function closeColForm() {
  $('#col-form').hidden = true;
  colEditing = null;
  colPreview = null;
}

$('#col-fetch').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#col-error').textContent = '';
  const btn = $('#col-fetch-btn');
  btn.disabled = true;
  btn.textContent = 'Buscando…';
  try {
    colEditing = null;
    colPreview = await NQ().api('/api/coluna/preview', { url: $('#col-url').value });
    fillColForm(colPreview);
  } catch (err) {
    $('#col-error').textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Buscar';
  }
});

$('#col-cancel').addEventListener('click', closeColForm);

$('#col-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const base = colEditing || colPreview;
  if (!base) return;
  const payload = {
    url: base.url,
    image_url: base.image_url,
    title: $('#col-title').value.trim(),
    summary: $('#col-summary').value.trim(),
    source: $('#col-source').value.trim(),
    published_at: fromDateInput($('#col-date').value, base.published_at),
  };
  try {
    if (colEditing) {
      await NQ().api(`/api/coluna/${colEditing.id}`, payload, 'PUT');
      NQ().toast('Coluna atualizada.');
    } else {
      const saved = await NQ().api('/api/coluna', payload);
      NQ().toast('Coluna adicionada ao site.');
      if ($('#col-announce').checked) {
        await announceText(`📰 Nova coluna Nas Quadras no ${saved.source}: ${saved.title}\n\n${saved.url}`);
      }
      $('#col-url').value = '';
    }
    closeColForm();
    listColumns();
  } catch (err) { NQ().toast(err.message); }
});

$('#col-list').addEventListener('click', async (e) => {
  const act = e.target.dataset.act;
  if (!act) return;
  const id = Number(e.target.closest('li').dataset.id);
  const c = $('#col-list').columns.find((x) => x.id === id);
  if (act === 'edit') {
    colEditing = c;
    colPreview = null;
    fillColForm(c, { editing: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (act === 'del') {
    if (!confirm(`Remover "${c.title}" da página Coluna? (O texto no JB não é afetado.)`)) return;
    try {
      await NQ().api(`/api/coluna/${id}`, undefined, 'DELETE');
      NQ().toast('Coluna removida do site.');
      listColumns();
    } catch (err) { NQ().toast(err.message); }
  }
});

// Primeira exibição (se o login já estiver feito).
route();
