// Texto de cada rede: tema no Threads, hashtags no Bluesky, menções por rede.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose, applyMentions, splitTags } from '../src/compose.js';
import { buildFacets } from '../src/text.js';
import * as bluesky from '../src/bluesky.js';

const tags = '#NBB #NasQuadras';
const mentions = [
  { key: 'nbb', name: 'NBB', threads: 'nbb', bluesky: '', x: 'nbb' },
  { key: 'foto_wallacelima', name: 'Wallace Lima', threads: 'foto_wallacelima', bluesky: 'wallacelima.bsky.social', x: '' },
];

test('Threads: 1º hashtag vira o tema e o texto sai limpo', () => {
  const c = compose({ network: 'threads', text: 'Fim de jogo!', tags });
  assert.equal(c.text, 'Fim de jogo!');
  assert.equal(c.topic, 'NBB');
  assert.equal(compose({ network: 'threads', text: 'oi', tags: '' }).topic, undefined);
});

test('Bluesky: hashtags no post solto, no 1º do fio e no fim de jogo', () => {
  assert.equal(compose({ network: 'bluesky', text: 'Pré-jogo', tags }).text, 'Pré-jogo\n\n#NBB #NasQuadras');
  assert.equal(compose({ network: 'bluesky', text: 'Abre o fio', tags, inThread: true, threadFirst: true }).text, 'Abre o fio\n\n#NBB #NasQuadras');
  assert.equal(compose({ network: 'bluesky', text: '24 x 26', tags, inThread: true }).text, '24 x 26');
  assert.equal(compose({ network: 'bluesky', text: 'FIM DE JOGO!', tags, inThread: true, final: true }).text, 'FIM DE JOGO!\n\n#NBB #NasQuadras');
});

test('site sem hashtags; X com hashtags; linhas em branco duplicadas somem', () => {
  assert.equal(compose({ network: 'site', text: 'a\n\n\n\nb', tags }).text, 'a\n\nb');
  assert.equal(compose({ network: 'x', text: 'a', tags }).text, 'a\n\n#NBB #NasQuadras');
  assert.deepEqual(splitTags('#NBB, #NasQuadras e #1'), ['#NBB', '#NasQuadras']);
});

test('menções: perfil de cada rede ou o nome', () => {
  const t = 'Vitória neste @nbb! foto: @Foto_WallaceLima';
  assert.equal(applyMentions(t, 'threads', mentions), 'Vitória neste @nbb! foto: @foto_wallacelima');
  assert.equal(applyMentions(t, 'bluesky', mentions), 'Vitória neste NBB! foto: @wallacelima.bsky.social');
  assert.equal(applyMentions(t, 'x', mentions), 'Vitória neste @nbb! foto: Wallace Lima');
  assert.equal(applyMentions('fale com @alguem', 'bluesky', mentions), 'fale com @alguem');
  assert.equal(applyMentions('e-mail p@x.com', 'bluesky', mentions), 'e-mail p@x.com');
});

test('Bluesky: facet de menção com o DID resolvido', () => {
  const text = 'foto: @wallacelima.bsky.social #NBB';
  const f = buildFacets(text, { 'wallacelima.bsky.social': 'did:plc:abc' });
  const m = f.find((x) => x.features[0].$type.endsWith('#mention'));
  assert.equal(m.features[0].did, 'did:plc:abc');
  assert.equal(text.slice(m.index.byteStart, m.index.byteEnd), '@wallacelima.bsky.social');
  assert.equal(buildFacets(text).filter((x) => x.features[0].$type.endsWith('#mention')).length, 0);
});

test('Bluesky: card do YouTube com título e miniatura', async () => {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push(String(url));
    if (String(url).includes('youtube.com/oembed')) return new Response(JSON.stringify({ title: 'BOTAFOGO X CAXIAS | NBB', author_name: 'NBB', thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg' }));
    if (String(url).includes('ytimg')) return new Response(new Uint8Array(100), { headers: { 'Content-Type': 'image/jpeg' } });
    if (String(url).includes('uploadBlob')) return new Response(JSON.stringify({ blob: { ref: { $link: 'b' }, size: 100 } }));
    return new Response('{}', { status: 404 });
  };
  const card = await bluesky.linkCard({}, { pds: 'https://pds.example', accessJwt: 'A' }, 'https://www.youtube.com/watch?v=ln8UerJ1x1A');
  assert.equal(card.$type, 'app.bsky.embed.external');
  assert.equal(card.external.title, 'BOTAFOGO X CAXIAS | NBB');
  assert.equal(card.external.description, 'YouTube · NBB');
  assert.ok(card.external.thumb);
  assert.equal(bluesky.firstUrl('📺 https://youtu.be/abc. Assista!'), 'https://youtu.be/abc');
});
