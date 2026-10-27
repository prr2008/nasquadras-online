import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFacets, graphemeLength, splitIntoThread } from '../src/text.js';

test('conta emojis e acentos como um caractere', () => {
  assert.equal(graphemeLength('Ação 🏀🔥'), 7);
  assert.equal(graphemeLength('👨‍👩‍👧'), 1);
});

test('texto curto não vira fio', () => {
  assert.deepEqual(splitIntoThread('Knicks vencem!', 300), ['Knicks vencem!']);
});

test('texto longo vira fio numerado, cada parte dentro do limite', () => {
  const text = 'Brunson '.repeat(120).trim();
  const parts = splitIntoThread(text, 300);
  assert.ok(parts.length > 1);
  parts.forEach((p, i) => {
    assert.ok(graphemeLength(p) <= 300, `parte ${i} tem ${graphemeLength(p)}`);
    assert.ok(p.endsWith(`(${i + 1}/${parts.length})`));
  });
});

test('palavra gigante é cortada sem estourar o limite', () => {
  const parts = splitIntoThread('x'.repeat(700), 300);
  parts.forEach((p) => assert.ok(graphemeLength(p) <= 300));
});

test('facets de hashtag e link usam posições em bytes UTF-8', () => {
  const text = '🏀 Spurs vencem! #NBA #NasQuadras https://jb.com.br/x.';
  const facets = buildFacets(text);
  const bytes = new TextEncoder().encode(text);
  const slice = (f) => new TextDecoder().decode(bytes.slice(f.index.byteStart, f.index.byteEnd));
  const tags = facets.filter((f) => f.features[0].$type.endsWith('#tag'));
  const links = facets.filter((f) => f.features[0].$type.endsWith('#link'));
  assert.deepEqual(tags.map(slice), ['#NBA', '#NasQuadras']);
  assert.deepEqual(links.map(slice), ['https://jb.com.br/x']);
  assert.equal(links[0].features[0].uri, 'https://jb.com.br/x');
});

test('não confunde número com hashtag', () => {
  assert.equal(buildFacets('Jogo #3 hoje').length, 0);
});
