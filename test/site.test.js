import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, renderText, postHtml, gamePage, indexPage, galleryPage } from '../src/site.js';

// 27/10/2026 22:33 em São Paulo (01:33 UTC do dia 28)
const START = Date.UTC(2026, 9, 28, 1, 33, 17);

test('slug usa o título sem acentos e a data de São Paulo', () => {
  assert.equal(slugify('Minas Storm x Pato Basquete', START), 'minas-storm-x-pato-basquete-27-10-2026');
  assert.equal(slugify('União Corinthians x Flamengo', START), 'uniao-corinthians-x-flamengo-27-10-2026');
  assert.equal(slugify('', START), 'cobertura-27-10-2026');
});

test('texto do post: escapa HTML, cria links e destaca hashtags', () => {
  const html = renderText('<script>alert(1)</script> Final!\nVeja https://lnb.com.br/x. #NBB #NasQuadras');
  assert.ok(!html.includes('<script>'), 'nunca pode injetar HTML');
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<a href="https:\/\/lnb\.com\.br\/x" target="_blank" rel="noopener nofollow">lnb\.com\.br\/x<\/a>\./);
  assert.match(html, /<span class="tag">#NBB<\/span> <span class="tag">#NasQuadras<\/span>/);
  assert.match(html, /Final!<br>Veja/);
});

test('link malicioso não escapa do atributo', () => {
  const html = renderText('https://x.com/"onmouseover="alert(1)');
  assert.ok(!/href="[^"]*"onmouseover/.test(html));
});

test('aspas e apóstrofos não viram hashtag nem quebram o HTML', () => {
  const html = renderText("Rachel's #3");
  assert.ok(!html.includes('class="tag">#39'));
  assert.ok(!html.includes('class="tag">#3<'), 'número sozinho não é hashtag');
});

const post = (over = {}) => ({
  id: 7, text: '🏀 Minas 86 x 65 Pato', created_at: START, score: '86 x 65 · Final',
  media: [{ key: '1793151197153-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg', kind: 'image', width: 1600, height: 900, alt: 'Rachel "arremessa"' }],
  ...over,
});

test('post: horário de Brasília, placar, foto com alt e botão de apagar só para o autor', () => {
  const pub = postHtml(post());
  assert.match(pub, /<time[^>]*>22:33<\/time>/);
  assert.match(pub, /86 x 65 · Final/);
  assert.match(pub, /alt="Rachel &quot;arremessa&quot;"/);
  assert.match(pub, /aspect-ratio:1600\/900/);
  assert.ok(!pub.includes('class="del"'));
  assert.match(postHtml(post(), { admin: true }), /class="del" data-id="7"/);
});

const game = {
  slug: 'minas-storm-x-pato-basquete-27-10-2026', title: 'Minas Storm x Pato Basquete', lnb_id: '27131',
  home: 'Minas Storm', away: 'Pato Basquete', home_score: 86, away_score: 65, period: 'FINAL', status: 'live',
  started_at: START, cover_key: '1793151197153-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg', n_posts: 2,
};

test('página do jogo: placar, prévia para compartilhar e sem "ao vivo" quando o jogo acabou', () => {
  const html = gamePage(game, [post()], 'https://app.example');
  assert.match(html, /<title>Minas Storm x Pato Basquete · Nas Quadras<\/title>/);
  assert.match(html, /property="og:image" content="https:\/\/app\.example\/m\/1793151197153/);
  assert.match(html, /og:description" content="Minas Storm 86 x 65 Pato Basquete · Final · 27\/10\/2026"/);
  assert.match(html, /<span class="pts">86<\/span>/);
  assert.ok(!html.includes('data-live="1"'), 'jogo encerrado não fica atualizando');
  assert.match(html, /Fotos \(1\)/);
  assert.match(html, /data-last="7"/);
});

test('jogo em andamento ativa a atualização ao vivo', () => {
  const html = gamePage({ ...game, period: '3Q' }, [], 'https://app.example');
  assert.match(html, /<body data-live="1">/);
  assert.match(html, /Ao vivo/);
  assert.match(html, /A cobertura vai começar/);
});

test('índice e galeria', () => {
  const idx = indexPage([game], 'https://app.example');
  assert.match(idx, /href="\/c\/minas-storm-x-pato-basquete-27-10-2026"/);
  assert.match(idx, /2 posts/);
  const gal = galleryPage(game, [post(), post({ id: 8, media: [] })], 'https://app.example');
  assert.match(gal, /Fotos \(1\)/);
  assert.match(gal, /<figcaption>22:33 · Rachel &quot;arremessa&quot;<\/figcaption>/);
});

test('cobertura com título padrão usa o nome dos times', async () => {
  const { withTitle } = await import('../src/site.js');
  assert.equal(withTitle({ title: 'Cobertura', home: 'Botafogo', away: 'Caxias do Sul' }).title, 'Botafogo x Caxias do Sul');
  assert.equal(withTitle({ title: 'Flamengo x Franca', home: 'Flamengo', away: 'Franca' }).title, 'Flamengo x Franca');
  assert.equal(withTitle({ title: 'Cobertura', home: null, away: null }).title, 'Cobertura');
});
