// Páginas públicas das coberturas: atualização ao vivo e "Apagar" para o autor logado.
(() => {
  const game = document.querySelector('.game');
  if (!game) return;
  const slug = game.dataset.slug;
  const postsEl = document.getElementById('posts');
  const banner = document.getElementById('new-posts');
  let last = Number(game.dataset.last) || 0;
  let pending = [];
  let live = document.body.dataset.live === '1';
  const POLL_MS = 20000;

  const atTop = () => window.scrollY < 300;

  function insert(items) {
    if (!items.length) return;
    postsEl.querySelector('.empty')?.remove();
    // Os itens chegam do mais novo para o mais antigo.
    const frag = document.createDocumentFragment();
    for (const it of items) {
      const tpl = document.createElement('template');
      tpl.innerHTML = it.html.trim();
      const el = tpl.content.firstElementChild;
      if (document.getElementById(el.id)) continue;
      el.classList.add('fresh');
      frag.append(el);
    }
    postsEl.prepend(frag);
  }

  function showBanner() {
    if (!pending.length) { banner.hidden = true; return; }
    banner.hidden = false;
    banner.innerHTML = `<button type="button">${pending.length} ${pending.length === 1 ? 'novo post' : 'novos posts'} ↑</button>`;
  }

  banner.addEventListener('click', () => {
    insert(pending);
    pending = [];
    showBanner();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  async function poll() {
    if (document.visibilityState !== 'visible') return;
    try {
      const res = await fetch(`/api/public/c/${encodeURIComponent(slug)}?since=${last}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const board = document.getElementById('board');
      if (board && data.board) board.outerHTML = data.board;
      if (data.posts.length) {
        last = Math.max(last, ...data.posts.map((p) => p.id));
        // Quem está no topo vê o post entrar; quem está lendo mais abaixo recebe um aviso.
        if (atTop() && !pending.length) insert(data.posts);
        else { pending = [...data.posts, ...pending]; showBanner(); }
      }
      if (!data.live) { live = false; clearInterval(timer); }
    } catch { /* tenta de novo no próximo ciclo */ }
  }

  let timer = null;
  if (live) {
    timer = setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (live) poll(); });
  }

  // Apagar post (só aparece para o autor logado no app).
  postsEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('.del');
    if (!btn) return;
    if (!confirm('Apagar este post do site? (Threads e Bluesky não são afetados.)')) return;
    const res = await fetch(`/api/site/post/${btn.dataset.id}`, { method: 'DELETE', headers: { 'X-NQ': '1' } });
    if (res.ok) btn.closest('.post').remove();
    else alert('Não foi possível apagar. Entre no app e tente de novo.');
  });
})();
