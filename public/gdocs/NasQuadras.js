/**
 * Nas Quadras — envia este documento do Google Docs para o blog.
 *
 * Instalação (uma vez, no documento-modelo):
 *   1. No Google Docs: Extensões → Apps Script. Apague o que estiver lá e cole este script.
 *   2. Na linha CONEXAO abaixo, cole o código gerado no app (Blog → Google Docs).
 *   3. Salve (ícone de disquete) e recarregue o documento. O menu "Nas Quadras" aparece.
 * Cada texto novo: Arquivo → Fazer uma cópia do modelo. Na primeira vez em cada
 * cópia, o Google pede para autorizar o script.
 *
 * @OnlyCurrentDoc
 */

// Código de conexão gerado no app (Blog → Google Docs → Gerar código). Fica entre as aspas.
const CONEXAO = '';

function onOpen() {
  DocumentApp.getUi().createMenu('Nas Quadras')
    .addItem('Enviar para o blog…', 'abrirPainel')
    .addToUi();
}

function abrirPainel() {
  DocumentApp.getUi().showSidebar(HtmlService.createHtmlOutput(PAINEL_HTML).setTitle('Nas Quadras · Blog'));
}

// ---------- Conexão com o app ----------

function conexao_() {
  const code = String(CONEXAO || '').trim();
  const m = code.match(/^(https:\/\/[^#\s]+)#([0-9a-f]{64})$/i);
  if (!m) throw new Error('Falta o código de conexão. Abra Extensões → Apps Script e cole o código do app na linha CONEXAO.');
  return { base: m[1].replace(/\/+$/, ''), token: m[2].toLowerCase() };
}

function chamar_(path, payload) {
  const c = conexao_();
  const res = UrlFetchApp.fetch(c.base + path, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + c.token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  let data = {};
  try { data = JSON.parse(res.getContentText()); } catch (e) { /* resposta não JSON */ }
  if (res.getResponseCode() >= 400) throw new Error(data.error || ('O site respondeu com erro ' + res.getResponseCode() + '.'));
  return data;
}

// ---------- Chamadas do painel ----------

function dadosDoPainel() {
  const doc = DocumentApp.getActiveDocument();
  const conv = converter_(doc, false);
  const info = chamar_('/api/gdocs/info', { docId: doc.getId() });
  return {
    info: info,
    title: conv.title,
    titleFromName: conv.titleFromName,
    subtitle: conv.summary,
    images: conv.imageCount,
    words: conv.words,
  };
}

function enviar(op) {
  const doc = DocumentApp.getActiveDocument();
  const conv = converter_(doc, true);
  return chamar_('/api/gdocs/import', {
    docId: doc.getId(),
    title: conv.title,
    summary: op.summary,
    category: op.category,
    html: conv.html,
    images: conv.images,
    cover: op.usarCapa && conv.images.length ? conv.images[0].id : null,
    status: op.publicar ? 'published' : 'draft',
    announce: Boolean(op.divulgar),
  });
}

// ---------- Conversão do documento em HTML ----------

function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function converter_(doc, comFotos) {
  const T = DocumentApp.ElementType;
  const H = DocumentApp.ParagraphHeading;
  const G = DocumentApp.GlyphType;
  const body = doc.getBody();
  const out = [];
  const images = [];
  let title = '';
  let summary = '';
  let lista = null;
  let n = 0;
  let primeiro = true;

  function fecharLista() { if (lista) { out.push('</' + lista + '>'); lista = null; } }

  function foto(img) {
    n++;
    const id = 'f' + n;
    if (comFotos) {
      const blob = img.getBlob();
      images.push({ id: id, mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) });
    }
    let alt = '';
    try { alt = img.getAltDescription() || img.getAltTitle() || ''; } catch (e) { /* imagem sem descrição */ }
    return '<img src="nq-img:' + id + '" alt="' + esc_(alt) + '">';
  }

  function texto(t) {
    const s = t.getText();
    const idx = t.getTextAttributeIndices();
    let html = '';
    for (let k = 0; k < idx.length; k++) {
      const a = idx[k];
      const b = k + 1 < idx.length ? idx[k + 1] : s.length;
      if (a >= b) continue;
      let seg = esc_(s.substring(a, b)).replace(/[\r\u000b]/g, '<br>');
      const link = t.getLinkUrl(a);
      if (t.isStrikethrough(a)) seg = '<s>' + seg + '</s>';
      if (t.isUnderline(a) && !link) seg = '<u>' + seg + '</u>';
      if (t.isItalic(a)) seg = '<em>' + seg + '</em>';
      if (t.isBold(a)) seg = '<strong>' + seg + '</strong>';
      if (link && /^(https?:|mailto:)/i.test(link)) seg = '<a href="' + esc_(link) + '">' + seg + '</a>';
      html += seg;
    }
    return html;
  }

  function inline(el) {
    let html = '';
    for (let i = 0; i < el.getNumChildren(); i++) {
      const c = el.getChild(i);
      const type = c.getType();
      if (type === T.TEXT) html += texto(c.asText());
      else if (type === T.INLINE_IMAGE) html += foto(c.asInlineImage());
      else if (type === T.HORIZONTAL_RULE) html += '<hr>';
      else if (T.RICH_LINK && type === T.RICH_LINK) {
        const r = c.asRichLink();
        html += '<a href="' + esc_(r.getUrl()) + '">' + esc_(r.getTitle() || r.getUrl()) + '</a>';
      }
    }
    return html;
  }

  for (let i = 0; i < body.getNumChildren(); i++) {
    const el = body.getChild(i);
    const type = el.getType();

    if (type === T.PARAGRAPH) {
      const p = el.asParagraph();
      const h = p.getHeading();
      const txt = p.getText().trim();
      const pos = p.getPositionedImages();
      if (h === H.TITLE && !title && txt) { title = txt; primeiro = false; continue; }
      if (h === H.SUBTITLE && !summary && txt) { summary = txt; continue; }
      if (primeiro && txt && h === H.HEADING1 && !title) { title = txt; primeiro = false; continue; }
      fecharLista();
      const inner = inline(p);
      if (!inner.replace(/<br>/g, '').trim() && !pos.length) continue;
      if (txt) primeiro = false;
      if (inner === '<hr>') { out.push('<hr>'); continue; }
      let tag = 'p';
      if (h === H.HEADING1 || h === H.HEADING2 || h === H.TITLE || h === H.SUBTITLE) tag = 'h2';
      else if (h === H.HEADING3) tag = 'h3';
      else if (h === H.HEADING4 || h === H.HEADING5 || h === H.HEADING6) tag = 'h4';
      else if ((p.getIndentStart() || 0) >= 30) tag = 'blockquote';
      if (inner.replace(/<br>/g, '').trim()) out.push('<' + tag + '>' + inner + '</' + tag + '>');
      for (let k = 0; k < pos.length; k++) out.push('<p>' + foto(pos[k]) + '</p>');
    } else if (type === T.LIST_ITEM) {
      const li = el.asListItem();
      const g = li.getGlyphType();
      const ordered = g === G.NUMBER || g === G.LATIN_UPPER || g === G.LATIN_LOWER || g === G.ROMAN_UPPER || g === G.ROMAN_LOWER;
      const tag = ordered ? 'ol' : 'ul';
      if (lista !== tag) { fecharLista(); out.push('<' + tag + '>'); lista = tag; }
      out.push('<li>' + inline(li) + '</li>');
      primeiro = false;
    } else if (type === T.TABLE) {
      fecharLista();
      const t = el.asTable();
      for (let r = 0; r < t.getNumRows(); r++) {
        const row = t.getRow(r);
        const cells = [];
        for (let c = 0; c < row.getNumCells(); c++) cells.push(row.getCell(c).getText().trim());
        const line = cells.filter(String).join(' · ');
        if (line) out.push('<p>' + esc_(line) + '</p>');
      }
    }
  }
  fecharLista();

  let titleFromName = false;
  if (!title) { title = doc.getName(); titleFromName = true; }
  const words = body.getText().split(/\s+/).filter(String).length;
  return { title: title, summary: summary, html: out.join('\n'), images: images, imageCount: n, words: words, titleFromName: titleFromName };
}

// ---------- Painel lateral ----------

const PAINEL_HTML = `<!doctype html>
<html><head><base target="_blank"><style>
  body { font: 14px/1.45 Arial, sans-serif; color: #202124; margin: 0; padding: 14px; }
  h1 { font-size: 17px; margin: 0 0 4px; line-height: 1.3; }
  .muted { color: #5f6368; font-size: 12px; }
  .warn { background: #fef7e0; border-radius: 8px; padding: 8px 10px; font-size: 12px; margin: 8px 0; }
  .err { background: #fce8e6; color: #a50e0e; border-radius: 8px; padding: 8px 10px; font-size: 13px; margin: 8px 0; }
  .ok { background: #e6f4ea; color: #137333; border-radius: 8px; padding: 8px 10px; font-size: 13px; margin: 8px 0; }
  .badge { display: inline-block; font-size: 11px; font-weight: bold; padding: 2px 8px; border-radius: 99px; background: #e8eaed; }
  .badge.published { background: #e6f4ea; color: #137333; }
  label.f { display: block; font-weight: bold; font-size: 12px; margin: 14px 0 4px; }
  select, textarea { width: 100%; box-sizing: border-box; font: inherit; padding: 6px 8px; border: 1px solid #dadce0; border-radius: 6px; }
  textarea { resize: vertical; }
  .check { display: flex; gap: 6px; align-items: flex-start; margin: 10px 0 0; font-size: 13px; }
  .buttons { display: grid; gap: 8px; margin-top: 18px; }
  button { font: inherit; font-weight: bold; padding: 9px 12px; border-radius: 6px; border: 1px solid #dadce0; background: #fff; cursor: pointer; }
  button.primary { background: #c8102e; border-color: #c8102e; color: #fff; }
  button.primary.confirm { background: #8a0b20; }
  button:disabled { opacity: .55; cursor: default; }
  .links a { margin-right: 12px; }
  [hidden] { display: none !important; }
</style></head><body>
  <div id="loading" class="muted">Lendo o documento…</div>
  <div id="main" hidden>
    <span id="badge" class="badge"></span>
    <h1 id="title"></h1>
    <div id="meta" class="muted"></div>
    <div id="nameWarn" class="warn" hidden>O título veio do nome do arquivo. Para definir o título do artigo, escreva-o na primeira linha com o estilo <b>Título</b>.</div>
    <div class="links muted" id="links"></div>

    <label class="f" for="category">Categoria</label>
    <select id="category"></select>

    <label class="f" for="summary">Resumo <span class="muted">(opcional)</span></label>
    <textarea id="summary" rows="3" maxlength="300" placeholder="Uma ou duas frases. Em branco, o site usa o começo do texto."></textarea>

    <label class="check" id="coverRow" hidden><input type="checkbox" id="usarCapa"> <span>Usar a primeira foto do documento como capa</span></label>
    <label class="check" id="announceRow"><input type="checkbox" id="divulgar"> <span>Ao publicar, divulgar no Threads e no Bluesky (título + link)</span></label>

    <div id="msg"></div>
    <div class="buttons">
      <button id="draft">Salvar como rascunho</button>
      <button id="publish" class="primary">Publicar no site</button>
    </div>
    <p class="muted">Depois de editar o documento, toque de novo para atualizar o artigo.</p>
  </div>
<script>
  var state = null, armed = false;
  function $(id) { return document.getElementById(id); }
  function msg(kind, text) { $('msg').innerHTML = ''; if (!text) return; var d = document.createElement('div'); d.className = kind; d.textContent = text; $('msg').appendChild(d); }
  function fmt(t) { return t ? new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''; }
  function link(href, text) { var a = document.createElement('a'); a.href = href; a.textContent = text; return a; }

  function render() {
    var a = state.info.article, pub = a && a.status === 'published';
    $('badge').textContent = a ? (pub ? 'Publicado' : 'Rascunho no site') : 'Ainda não enviado';
    $('badge').className = 'badge' + (pub ? ' published' : '');
    $('title').textContent = state.title;
    $('nameWarn').hidden = !state.titleFromName;
    $('meta').textContent = state.words + ' palavras · ' + state.images + (state.images === 1 ? ' foto' : ' fotos') + (a ? ' · enviado em ' + fmt(a.updated_at) : '');
    var L = $('links'); L.innerHTML = '';
    if (a) { L.appendChild(link(a.url, pub ? 'Ver no site ↗' : 'Ver rascunho ↗')); L.appendChild(link(a.editUrl, 'Abrir no app ↗')); }
    $('draft').hidden = pub;
    $('publish').textContent = pub ? 'Atualizar publicação' : 'Publicar no site';
    $('announceRow').hidden = pub;
    $('coverRow').hidden = !state.images;
  }

  function load() {
    google.script.run.withSuccessHandler(function (d) {
      state = d;
      var a = d.info.article;
      $('category').innerHTML = '';
      d.info.categories.forEach(function (c) { var o = document.createElement('option'); o.textContent = c; $('category').appendChild(o); });
      $('category').value = a ? a.category : 'NBB';
      $('summary').value = a ? (a.summary || '') : (d.subtitle || '');
      $('usarCapa').checked = !!d.images && !(a && a.hasCover);
      $('loading').hidden = true; $('main').hidden = false;
      render();
    }).withFailureHandler(function (e) {
      $('loading').className = 'err'; $('loading').textContent = e.message;
    }).dadosDoPainel();
  }

  function send(publicar) {
    var pub = state.info.article && state.info.article.status === 'published';
    if (publicar && !pub && !armed) {
      armed = true; $('publish').classList.add('confirm'); $('publish').textContent = 'Toque de novo para confirmar';
      setTimeout(function () { armed = false; $('publish').classList.remove('confirm'); render(); }, 5000);
      return;
    }
    armed = false; $('publish').classList.remove('confirm');
    $('draft').disabled = $('publish').disabled = true;
    msg('muted', 'Enviando o texto e as fotos…');
    google.script.run.withSuccessHandler(function (r) {
      $('draft').disabled = $('publish').disabled = false;
      state.info.article = r.article;
      render();
      var t = r.article.status === 'published' ? (r.firstPublish ? 'Publicado no site!' : 'Publicação atualizada.') : 'Rascunho salvo no site.';
      if (r.announced) {
        var ok = [], bad = [];
        ['threads', 'bluesky'].forEach(function (k) { var v = r.announced[k]; if (v && v.error) bad.push(k + ': ' + v.error); else if (v) ok.push(k === 'threads' ? 'Threads' : 'Bluesky'); });
        if (ok.length) t += ' Divulgado no ' + ok.join(' e ') + '.';
        if (bad.length) t += ' Não divulgou — ' + bad.join('; ');
      }
      msg('ok', t);
    }).withFailureHandler(function (e) {
      $('draft').disabled = $('publish').disabled = false;
      msg('err', e.message);
    }).enviar({
      publicar: publicar,
      category: $('category').value,
      summary: $('summary').value.trim(),
      usarCapa: $('usarCapa').checked && !$('coverRow').hidden,
      divulgar: $('divulgar').checked && !$('announceRow').hidden,
    });
  }

  $('draft').onclick = function () { send(false); };
  $('publish').onclick = function () { send(true); };
  load();
</script>
</body></html>`;
