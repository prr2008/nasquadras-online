// Editor visual do Blog e das páginas fixas do site (usa o Quill, incluído em /vendor/quill).

const $ = (sel) => document.querySelector(sel);
const NQ = () => window.NQ;
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const siteOrigin = () => (location.hostname === 'app.nasquadras.online' ? 'https://nasquadras.online' : location.origin);

// ---------- Navegação entre Ao vivo / Blog / Páginas ----------

function show(view) {
  for (const v of ['live', 'blog', 'coluna', 'zona', 'pages']) $(`#view-${v}`).hidden = v !== view;
  document.querySelectorAll('.app-tabs a[data-view]').forEach((a) => a.classList.toggle('on', a.dataset.view === view));
}

async function route() {
  if ($('#app').hidden) return; // ainda no login
  const [path, qs] = location.hash.replace(/^#/, '').split('?');
  const [section, arg] = path.split('/');
  if (qs) handleReturn(new URLSearchParams(qs), section);
  try {
    if (section === 'blog') {
      show('blog');
      if (arg === 'novo') return openArticle(null);
      if (arg) return openArticle(Number(arg));
      return listArticles();
    }
    if (section === 'zona') {
      show('zona');
      spotifyStatus().catch(() => {});
      return listEpisodes();
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

// ---------- Blocos especiais do editor ----------
// 1) Vídeo: o Quill exporta vídeo como link (<a>); aqui ele sai como <iframe>,
//    para o player continuar no site depois de salvar.
// 2) Posts do X e do Instagram incorporados: aparecem no editor como um bloco
//    (não editável) e saem no HTML no formato que os scripts do X/Instagram usam.
const Q = window.Quill;
const escAttr = (s) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const VideoBlot = Q.import('formats/video');
class PlayerVideo extends VideoBlot {
  html() { return `<iframe src="${escAttr(this.domNode.getAttribute('src'))}"></iframe>`; }
}
Q.register(PlayerVideo, true);

const BlockEmbed = Q.import('blots/block/embed');
class XPost extends BlockEmbed {
  static blotName = 'xpost';
  static tagName = 'BLOCKQUOTE';
  static className = 'twitter-tweet';
  static create(v) {
    const node = super.create();
    node.setAttribute('contenteditable', 'false');
    const p = document.createElement('p');
    p.textContent = v?.text || '';
    const a = document.createElement('a');
    a.href = v?.url || '';
    a.textContent = v?.url || '';
    node.append(p, a);
    return node;
  }
  static value(node) {
    const links = [...node.querySelectorAll('a')];
    const a = links.find((x) => /\/status\//.test(x.getAttribute('href') || '')) || links.at(-1);
    return { url: a?.getAttribute('href') || '', text: (node.querySelector('p')?.textContent || '').trim() };
  }
  html() {
    const v = XPost.value(this.domNode);
    return `<blockquote class="twitter-tweet"><p>${escAttr(v.text)}</p><a href="${escAttr(v.url)}">${escAttr(v.url)}</a></blockquote>`;
  }
}
class InstagramPost extends BlockEmbed {
  static blotName = 'igpost';
  static tagName = 'BLOCKQUOTE';
  static className = 'instagram-media';
  static create(v) {
    const node = super.create();
    node.setAttribute('contenteditable', 'false');
    node.setAttribute('data-instgrm-permalink', v?.url || '');
    const a = document.createElement('a');
    a.href = v?.url || '';
    a.textContent = 'Ver este post no Instagram';
    node.append(a);
    return node;
  }
  static value(node) {
    return { url: node.getAttribute('data-instgrm-permalink') || node.querySelector('a')?.getAttribute('href') || '' };
  }
  html() {
    const { url } = InstagramPost.value(this.domNode);
    return `<blockquote class="instagram-media" data-instgrm-permalink="${escAttr(url)}"><a href="${escAttr(url)}">Ver este post no Instagram</a></blockquote>`;
  }
}
Q.register(XPost, true);
Q.register(InstagramPost, true);

/** Link de post do X/Twitter ou do Instagram -> bloco incorporado. */
function toSocial(url) {
  const s = String(url || '').trim();
  let m = s.match(/^https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/(\w+)\/status\/(\d+)/);
  if (m) return { type: 'xpost', value: { url: `https://twitter.com/${m[1]}/status/${m[2]}`, text: '' } };
  m = s.match(/^https?:\/\/(?:www\.)?instagram\.com\/(p|reel|tv)\/([\w-]+)/);
  if (m) return { type: 'igpost', value: { url: `https://www.instagram.com/${m[1]}/${m[2]}/` } };
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
            const url = prompt('Cole o link do YouTube, Spotify, Vimeo, ou de um post do X ou do Instagram:');
            if (!url) return;
            const range = quill.getSelection(true);
            const social = toSocial(url);
            if (social) {
              quill.insertEmbed(range.index, social.type, social.value, 'user');
              quill.setSelection(range.index + 1, 0);
              return;
            }
            const embed = toEmbed(url);
            if (!embed) { NQ().toast('Link não reconhecido. Use YouTube, Spotify, Vimeo, X ou Instagram.'); return; }
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

// ---------- Importar do WordPress ----------

$('#wp-go').addEventListener('click', async () => {
  const site = $('#wp-site').value.trim();
  const dryRun = $('#wp-dry').checked;
  if (!site) return;
  if (!dryRun && !confirm(`Importar os posts de ${site} já publicados no blog?`)) return;
  const btn = $('#wp-go');
  btn.disabled = true;
  const log = $('#wp-log');
  log.innerHTML = '';
  const esc = NQ().esc;
  let offset = 0;
  let totals = { ok: 0, skipped: 0, errors: 0, found: 0 };
  try {
    for (let guard = 0; guard < 200; guard++) {
      btn.textContent = `Importando… ${offset}${totals.found ? `/${totals.found}` : ''}`;
      const r = await NQ().api('/api/blog/import-wp', { site, offset, limit: 3, dryRun });
      totals.found = r.found;
      for (const it of r.results) {
        const rep = it.report || {};
        const media = [rep.images && `${rep.images} foto(s)`, rep.youtube && `${rep.youtube} YouTube`, rep.spotify && `${rep.spotify} Spotify`,
          rep.videopress && `${rep.videopress} vídeo(s) WordPress`, rep.podcast && `${rep.podcast} podcast(s)`, rep.x && `${rep.x} post(s) do X`, rep.instagram && `${rep.instagram} Instagram`].filter(Boolean).join(', ');
        const status = it.error ? `<b class="bad">erro: ${esc(it.error)}</b>` : it.skipped ? 'já importado' : it.simulated ? `simulado · ${esc(it.category)}` : `<a href="#blog/${it.articleId}">importado</a> · ${esc(it.category)}`;
        const warn = rep.imageErrors?.length ? `<br><b class="bad">fotos com problema: ${esc(rep.imageErrors.join('; '))}</b>` : '';
        log.insertAdjacentHTML('beforeend', `<li><strong>${esc(it.title)}</strong> <span class="meta">${new Date(it.date).toLocaleDateString('pt-BR')} · ${status}${media ? ` · ${media}` : ''}${warn}</span></li>`);
        if (it.error) totals.errors++; else if (it.skipped) totals.skipped++; else totals.ok++;
      }
      offset = r.next;
      if (r.done) break;
    }
    NQ().toast(`${dryRun ? 'Simulação' : 'Importação'} concluída: ${totals.ok} ${dryRun ? 'post(s) analisados' : 'importado(s)'}${totals.skipped ? `, ${totals.skipped} já existiam` : ''}${totals.errors ? `, ${totals.errors} com erro` : ''}.`, 7000);
    if (!dryRun) listArticles();
  } catch (err) {
    NQ().toast(err.message, 7000);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Importar';
  }
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

// ---------- Zona de Conforto (edições com a playlist do Spotify) ----------

let epEditing = null;
let epPreview = null;
const epLabel = (e) => [e.number ? `Ep. ${e.number}` : '', e.aired_at ? fmtDate(e.aired_at) : ''].filter(Boolean).join(' · ') || e.playlist_name || 'Edição';

async function listEpisodes() {
  const { episodes } = await NQ().api('/api/zona');
  const esc = NQ().esc;
  $('#ep-list').innerHTML = episodes.length ? episodes.map((e) => `
    <li data-id="${e.id}">
      ${e.image_url ? `<img class="thumb-sm" src="${esc(e.image_url)}" alt="">` : '<div class="thumb-sm"></div>'}
      <div class="info">
        <strong>${esc(epLabel(e))}${e.title ? ` — ${esc(e.title)}` : ''}</strong>
        <span class="meta">${esc(e.playlist_name || '')}</span>
        <span class="actions">
          <a href="https://open.spotify.com/playlist/${esc(e.playlist_id)}" target="_blank" rel="noopener">Spotify ↗</a>
          <button type="button" data-act="edit">Editar</button>
          <button type="button" data-act="del">Remover</button>
        </span>
      </div>
    </li>`).join('') : '<li class="empty-item" style="display:block;background:none;border:0">Nenhuma edição ainda. Cole o link de uma playlist acima.</li>';
  $('#ep-list').episodes = episodes;
}

function fillEpForm(d, { editing = false } = {}) {
  $('#ep-form').hidden = false;
  $('#ep-name').textContent = d.playlist_name || 'Playlist sem nome (privada?)';
  $('#ep-number').value = d.number || '';
  $('#ep-date').value = d.aired_at ? toDateInput(d.aired_at) : '';
  $('#ep-title').value = d.title || '';
  $('#ep-summary').value = d.summary || '';
  const url = d.playlist_url || `https://open.spotify.com/playlist/${d.playlist_id}`;
  $('#ep-link').href = url;
  $('#ep-link').textContent = url.replace(/^https?:\/\//, '');
  $('#ep-img').innerHTML = d.image_url ? `<img src="${NQ().esc(d.image_url)}" alt="">` : '<span>Sem capa</span>';
  $('#ep-private').hidden = editing || d.public !== false;
  $('#ep-save').textContent = editing ? 'Salvar alterações' : 'Adicionar edição';
  $('#ep-title').focus();
}

function closeEpForm() {
  $('#ep-form').hidden = true;
  epEditing = null;
  epPreview = null;
}

$('#ep-fetch').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#ep-error').textContent = '';
  const btn = $('#ep-fetch-btn');
  btn.disabled = true;
  btn.textContent = 'Buscando…';
  try {
    epEditing = null;
    epPreview = await NQ().api('/api/zona/preview', { url: $('#ep-url').value });
    fillEpForm(epPreview);
  } catch (err) {
    $('#ep-error').textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Buscar';
  }
});

$('#ep-cancel').addEventListener('click', closeEpForm);

$('#ep-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const base = epEditing || epPreview;
  if (!base) return;
  const date = $('#ep-date').value;
  const payload = {
    playlist_url: base.playlist_url || `https://open.spotify.com/playlist/${base.playlist_id}`,
    playlist_name: base.playlist_name,
    image_url: base.image_url,
    number: $('#ep-number').value,
    aired_at: date ? fromDateInput(date, base.aired_at) : null,
    title: $('#ep-title').value.trim(),
    summary: $('#ep-summary').value.trim(),
  };
  try {
    if (epEditing) {
      await NQ().api(`/api/zona/${epEditing.id}`, payload, 'PUT');
      NQ().toast('Edição atualizada.');
    } else {
      await NQ().api('/api/zona', payload);
      NQ().toast('Edição adicionada ao site.');
      $('#ep-url').value = '';
    }
    closeEpForm();
    listEpisodes();
  } catch (err) { NQ().toast(err.message); }
});

$('#ep-list').addEventListener('click', async (e) => {
  const act = e.target.dataset.act;
  if (!act) return;
  const id = Number(e.target.closest('li').dataset.id);
  const ep = $('#ep-list').episodes.find((x) => x.id === id);
  if (act === 'edit') {
    epEditing = ep;
    epPreview = null;
    fillEpForm(ep, { editing: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (act === 'del') {
    if (!confirm(`Remover "${epLabel(ep)}" da página Zona de Conforto? (A playlist no Spotify não é afetada.)`)) return;
    try {
      await NQ().api(`/api/zona/${id}`, undefined, 'DELETE');
      NQ().toast('Edição removida do site.');
      listEpisodes();
    } catch (err) { NQ().toast(err.message); }
  }
});

// ---------- Spotify: nova edição a partir da lista ----------

/** Volta do login do Spotify: #zona?spotify=ok|cancelado|erro&msg=… */
function handleReturn(q, section) {
  const sp = q.get('spotify');
  if (sp === 'ok') NQ().toast('Spotify conectado!');
  else if (sp === 'cancelado') NQ().toast('Conexão com o Spotify cancelada.');
  else if (sp === 'erro') NQ().toast(`Spotify: ${q.get('msg') || 'não foi possível conectar.'}`, 8000);
  history.replaceState(null, '', `#${section}`);
  lastHash = location.hash;
}

let spConnected = false;
async function spotifyStatus() {
  const st = await NQ().api('/api/spotify/status');
  spConnected = st.connected;
  $('#sp-status').innerHTML = st.connected
    ? `Spotify: conectado como <strong>${NQ().esc(st.name || '')}</strong>`
    : st.configured ? 'Spotify: não conectado.' : 'Spotify: falta o SPOTIFY_CLIENT_ID na configuração.';
  $('#sp-connect').hidden = st.connected || !st.configured;
  $('#sp-disconnect').hidden = !st.connected;
  $('#nw-match').disabled = !st.connected;
  $('#imp-load').disabled = !st.connected;
}

$('#sp-disconnect').addEventListener('click', async () => {
  if (!confirm('Desconectar o Spotify deste app? (As playlists e as edições do site continuam.)')) return;
  await NQ().api('/api/spotify/disconnect', {});
  spotifyStatus();
});

// Nome da playlist acompanha número e data até ser editado à mão.
let nameTouched = false;
const pad2 = (n) => String(n).padStart(2, '0');
function autoName() {
  if (nameTouched) return;
  const n = $('#nw-number').value;
  const d = $('#nw-date').value;
  const date = d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '';
  $('#nw-name').value = ['Zona de Conforto', n ? `Ep. ${n}` : '', date].filter(Boolean).join(' · ');
}
['#nw-number', '#nw-date'].forEach((id) => $(id).addEventListener('input', autoName));
$('#nw-name').addEventListener('input', () => { nameTouched = Boolean($('#nw-name').value.trim()); });
autoName();

let tracks = []; // [{ line, candidates, pick, on }]
const mmss = (ms) => `${Math.floor(ms / 60000)}:${pad2(Math.round((ms % 60000) / 1000) % 60)}`;
const WARN = 0.6;

function renderTracks() {
  const esc = NQ().esc;
  $('#trk-list').innerHTML = tracks.map((t, i) => {
    const c = t.candidates[t.pick];
    const missing = !c;
    const warn = c && c.score < WARN;
    const flag = missing ? ' · <b>não encontrada</b>' : warn ? ' · <b>confira</b>' : '';
    return `<li class="trk ${missing ? 'missing' : warn ? 'warn' : ''} ${t.on ? '' : 'off'}" data-i="${i}">
      <input type="checkbox" data-act="on" ${t.on && c ? 'checked' : ''} ${c ? '' : 'disabled'} aria-label="Incluir">
      ${c?.image ? `<img src="${esc(c.image)}" alt="">` : '<div class="ph"></div>'}
      <div class="trk-info">
        <span class="trk-line">${i + 1}. ${esc(t.line)}${flag}</span>
        ${t.candidates.length ? `<select data-act="pick">${t.candidates.map((x, k) => `<option value="${k}" ${k === t.pick ? 'selected' : ''}>${esc(x.name)} — ${esc(x.artists)} · ${esc(x.album)} · ${mmss(x.duration_ms)}</option>`).join('')}</select>` : ''}
        <div class="trk-more"><input placeholder="Buscar outra versão" value="" data-act="q"><button type="button" class="ghost small" data-act="search">Buscar</button></div>
      </div>
      ${c ? `<a class="play" href="${esc(c.url)}" target="_blank" rel="noopener" title="Ouvir no Spotify">▶</a>` : '<span></span>'}
    </li>`;
  }).join('');
  const ok = tracks.filter((t) => t.on && t.candidates[t.pick]).length;
  const warns = tracks.filter((t) => t.candidates[t.pick] && t.candidates[t.pick].score < WARN).length;
  const miss = tracks.filter((t) => !t.candidates[t.pick]).length;
  $('#nw-summary').textContent = tracks.length
    ? `${ok} de ${tracks.length} músicas selecionadas.${warns ? ` ${warns} para conferir (borda amarela).` : ''}${miss ? ` ${miss} não encontradas: busque outra versão ou siga sem elas.` : ''}`
    : '';
  $('#nw-final').hidden = !ok;
  $('#nw-create').textContent = `Criar playlist com ${ok} músicas e publicar no site`;
}

$('#nw-match').addEventListener('click', async () => {
  const lines = $('#nw-lines').value.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return NQ().toast('Cole a lista de músicas.');
  const btn = $('#nw-match');
  btn.disabled = true;
  btn.textContent = `Buscando ${lines.length} músicas…`;
  try {
    const { results } = await NQ().api('/api/spotify/match', { lines });
    tracks = results.map((r) => ({ line: r.line, candidates: r.candidates || [], pick: 0, on: Boolean(r.candidates?.length) }));
    renderTracks();
  } catch (err) { NQ().toast(err.message, 6000); } finally {
    btn.disabled = !spConnected;
    btn.textContent = 'Buscar músicas no Spotify';
  }
});

$('#trk-list').addEventListener('change', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  const t = tracks[Number(li.dataset.i)];
  const act = e.target.dataset.act;
  if (act !== 'pick' && act !== 'on') return; // o campo de busca não redesenha a lista
  if (act === 'pick') t.pick = Number(e.target.value);
  if (act === 'on') t.on = e.target.checked;
  renderTracks();
});

async function searchAgain(li) {
  const t = tracks[Number(li.dataset.i)];
  const q = li.querySelector('[data-act=q]').value.trim() || t.line;
  try {
    const { tracks: found } = await NQ().api('/api/spotify/search', { q });
    if (!found.length) return NQ().toast('Nada encontrado com essa busca.');
    t.candidates = found.sort((a, b) => b.score - a.score);
    t.pick = 0;
    t.on = true;
    renderTracks();
  } catch (err) { NQ().toast(err.message); }
}
$('#trk-list').addEventListener('click', (e) => {
  if (e.target.dataset.act === 'search') searchAgain(e.target.closest('li'));
});
$('#trk-list').addEventListener('keydown', (e) => {
  if (e.target.dataset.act === 'q' && e.key === 'Enter') { e.preventDefault(); searchAgain(e.target.closest('li')); }
});

$('#nw-create').addEventListener('click', async () => {
  const chosen = tracks.filter((t) => t.on && t.candidates[t.pick]).map((t) => t.candidates[t.pick]);
  const name = $('#nw-name').value.trim();
  if (!name) return NQ().toast('Dê um nome à playlist.');
  if (!confirm(`Criar a playlist pública "${name}" com ${chosen.length} músicas no seu Spotify e publicar a edição no site?`)) return;
  const btn = $('#nw-create');
  btn.disabled = true;
  btn.textContent = 'Criando…';
  const date = $('#nw-date').value;
  try {
    const ep = await NQ().api('/api/zona/create', {
      name,
      number: $('#nw-number').value,
      aired_at: date ? fromDateInput(date) : null,
      title: $('#nw-title').value.trim(),
      summary: $('#nw-summary-text').value.trim(),
      uris: chosen.map((c) => c.uri),
      image_url: chosen[0]?.imageLarge || null,
    });
    NQ().toast('Playlist criada e edição publicada no site!', 5000);
    if ($('#nw-announce').checked) {
      await announceText(`🎧 As músicas do ${name.replace(/^Zona de Conforto/, 'Zona de Conforto')}${$('#nw-title').value.trim() ? ` — ${$('#nw-title').value.trim()}` : ''}\n\n${siteOrigin()}/zona-de-conforto#ep-${ep.id}`);
    }
    tracks = [];
    renderTracks();
    for (const id of ['#nw-number', '#nw-date', '#nw-title', '#nw-lines', '#nw-summary-text']) $(id).value = '';
    nameTouched = false;
    autoName();
    listEpisodes();
  } catch (err) {
    NQ().toast(err.message, 8000);
  } finally {
    btn.disabled = false;
    renderTracks();
  }
});

// ---------- Importar playlists antigas ----------

let importable = [];
$('#imp-load').addEventListener('click', async () => {
  const btn = $('#imp-load');
  btn.disabled = true;
  btn.textContent = 'Buscando…';
  try {
    const { playlists } = await NQ().api('/api/spotify/zona-playlists');
    importable = playlists;
    const esc = NQ().esc;
    $('#imp-list').innerHTML = playlists.length ? playlists.map((p, i) => `
      <li>
        <input type="checkbox" data-i="${i}" ${p.onSite ? 'disabled' : 'checked'} aria-label="Importar">
        ${p.image ? `<img src="${esc(p.image)}" alt="">` : '<div class="ph"></div>'}
        <div><strong>${esc(p.name)}</strong>
          <span class="meta">${p.onSite ? 'Já está no site' : p.public ? 'Pública' : 'Privada (vai ficar pública)'}${p.total != null ? ` · ${p.total} músicas` : ''} · ${p.aired_at ? `data: ${fmtDate(p.aired_at)}` : 'sem data no nome (dá para pôr depois em Editar)'}${p.number ? ` · Ep. ${p.number}` : ''}</span></div>
      </li>`).join('') : '<li>Nenhuma playlist com "Zona de Conforto" no nome.</li>';
    $('#imp-go').hidden = !playlists.some((p) => !p.onSite);
  } catch (err) { NQ().toast(err.message, 6000); } finally {
    btn.disabled = !spConnected;
    btn.textContent = 'Buscar minhas playlists';
  }
});

$('#imp-go').addEventListener('click', async () => {
  const items = [...document.querySelectorAll('#imp-list input:checked:not(:disabled)')].map((c) => importable[Number(c.dataset.i)]);
  if (!items.length) return NQ().toast('Marque as playlists que quer importar.');
  const priv = items.filter((p) => !p.public).length;
  if (!confirm(`Adicionar ${items.length} ${items.length === 1 ? 'edição' : 'edições'} ao site?${priv ? ` ${priv} ${priv === 1 ? 'playlist privada vai ficar pública' : 'playlists privadas vão ficar públicas'} no Spotify.` : ''}`)) return;
  const btn = $('#imp-go');
  btn.disabled = true;
  try {
    const { results } = await NQ().api('/api/zona/import', { items });
    const ok = results.filter((r) => r.ok).length;
    const bad = results.filter((r) => !r.ok);
    NQ().toast(`${ok} ${ok === 1 ? 'edição adicionada' : 'edições adicionadas'} ao site.${bad.length ? ` Falharam: ${bad.map((b) => b.error).join('; ')}` : ''}`, 7000);
    $('#imp-load').click();
    listEpisodes();
  } catch (err) { NQ().toast(err.message, 6000); } finally { btn.disabled = false; }
});

// Primeira exibição (se o login já estiver feito).
route();
