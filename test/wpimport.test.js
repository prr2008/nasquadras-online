// Importação do WordPress: embeds, fotos copiadas, capa e categoria.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareHtml, convertPost, guessCategory, siteHost } from '../src/wpimport.js';

const WP = `
<p>Texto de abertura com <strong>negrito</strong>.</p>
<figure class="wp-block-image size-large"><a href="https://prr2008.wordpress.com/wp-content/uploads/2025/05/img_0795.jpg"><img data-attachment-id="12" data-orig-file="https://prr2008.wordpress.com/wp-content/uploads/2025/05/img_0795.jpg" src="https://prr2008.wordpress.com/wp-content/uploads/2025/05/img_0795.jpg?w=1024" alt="Marquinhos" srcset="x 1x" class="wp-image-12"/></a><figcaption class="wp-element-caption">Foto: Gilvan</figcaption></figure>
<figure class="wp-block-embed is-type-rich is-provider-twitter wp-block-embed-twitter"><div class="wp-block-embed__wrapper"><blockquote class="twitter-tweet" data-width="550" data-dnt="true"><p lang="pt" dir="ltr">Que jogo!</p>&mdash; NBB (@nbb) <a href="https://twitter.com/nbb/status/1925000000000000000?ref_src=twsrc%5Etfw">May 24, 2025</a></blockquote><script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script></div></figure>
<figure class="wp-block-embed is-type-video is-provider-youtube"><div class="wp-block-embed__wrapper">
https://www.youtube.com/watch?v=ln8UerJ1x1A
</div></figure>
<figure class="wp-block-embed is-provider-instagram"><div class="wp-block-embed__wrapper"><blockquote class="instagram-media" data-instgrm-captioned data-instgrm-permalink="https://www.instagram.com/p/DJabc123/?utm_source=ig_embed&amp;utm_campaign=loading" data-instgrm-version="14" style="background:#FFF"><div>…</div></blockquote><script async src="//www.instagram.com/embed.js"></script></div></figure>
<iframe class="youtube-player" width="640" height="360" src="https://www.youtube.com/embed/abcdefg?version=3&#038;rel=1" allowfullscreen="true"></iframe>
<p>https://open.spotify.com/playlist/7sMtYRefZqzz78k1rpdiZW?si=x</p>`;

test('prepara os embeds do WordPress', () => {
  const h = prepareHtml(WP);
  assert.doesNotMatch(h, /<script/);
  assert.match(h, /<iframe src="https:\/\/www\.youtube\.com\/embed\/ln8UerJ1x1A"><\/iframe>/);
  assert.match(h, /data-instgrm-permalink="https:\/\/www\.instagram\.com\/p\/DJabc123\/"/);
  assert.match(h, /href="https:\/\/twitter\.com\/nbb\/status\/1925000000000000000"/);
  assert.match(h, /<iframe src="https:\/\/open\.spotify\.com\/embed\/playlist\/7sMtYRefZqzz78k1rpdiZW"><\/iframe>/);
  assert.doesNotMatch(h, /<a href="[^"]+\.jpg"><img/);
});

test('copia as fotos (maior resolução), usa a 1ª como capa e conta os embeds', async () => {
  const fetched = [];
  globalThis.fetch = async (url) => { fetched.push(String(url)); return new Response(new Uint8Array(500), { headers: { 'Content-Type': 'image/jpeg' } }); };
  const puts = [];
  const env = { MEDIA: { put: async (k) => puts.push(k) } };
  const r = await convertPost(env, { content: WP });
  assert.equal(fetched[0], 'https://prr2008.wordpress.com/wp-content/uploads/2025/05/img_0795.jpg?w=1600');
  assert.equal(r.report.images, 1);
  assert.match(r.cover, /^\d{13}-[0-9a-f-]{36}\.jpg$/);
  assert.match(r.html, new RegExp(`<img src="/m/${r.cover}" alt="Marquinhos">`));
  assert.deepEqual([r.report.youtube, r.report.x, r.report.instagram, r.report.spotify], [2, 1, 1, 1]);
});

test('sem foto, a miniatura do YouTube vira capa; post que abre com a foto não a repete', async () => {
  globalThis.fetch = async () => new Response(new Uint8Array(10), { headers: { 'Content-Type': 'image/jpeg' } });
  const env = { MEDIA: { put: async () => {} } };
  const yt = await convertPost(env, { content: '<p>Oi</p><p>https://youtu.be/ln8UerJ1x1A</p>' });
  assert.ok(yt.cover && yt.report.coverFromYoutube);
  const first = await convertPost(env, { content: '<figure class="wp-block-image"><img src="https://prr2008.wordpress.com/wp-content/uploads/a.jpg"/><figcaption>c</figcaption></figure><p>Texto</p>' });
  assert.equal(first.html.trim(), '<p>Texto</p>');
});

test('categoria pelo assunto e endereço do site', () => {
  assert.equal(guessCategory({ title: 'Thunder UP!', content: '<p>O Thunder venceu o Pacers no Jogo 7 das Finais da NBA.</p>' }), 'NBA');
  assert.equal(guessCategory({ title: 'Jogão', content: '<p>Flamengo e Franca no NBB, no Maracanãzinho.</p>', categories: { NBB: {} } }), 'NBB');
  assert.equal(guessCategory({ title: 'Uma crônica', content: '<p>Sobre a vida.</p>' }), 'Opinião');
  assert.equal(siteHost('https://prr2008.wordpress.com/'), 'prr2008.wordpress.com');
  assert.throws(() => siteHost('javascript:alert(1)'));
});

test('podcast do Anchor e vídeo do VideoPress viram player', () => {
  const h = prepareHtml('<div class="wp-block-embed__wrapper">https://anchor.fm/prr2008/episodes/A-Temporada-e1abc</div><div class="wp-block-embed__wrapper">https://videopress.com/v/AbC123?resizeToParent=true</div>');
  assert.match(h, /<iframe src="https:\/\/anchor\.fm\/prr2008\/embed\/episodes\/A-Temporada-e1abc"><\/iframe>/);
  assert.match(h, /<iframe src="https:\/\/videopress\.com\/embed\/AbC123"><\/iframe>/);
});
