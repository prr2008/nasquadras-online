// Utilitários de texto compartilhados (contagem, divisão em fio e "facets" do Bluesky).

export const THREADS_MAX = 500;
export const BLUESKY_MAX = 300;

const segmenter = new Intl.Segmenter('pt-BR', { granularity: 'grapheme' });

/** Conta caracteres visíveis (grafemas), como o Bluesky conta. */
export function graphemeLength(text) {
  let n = 0;
  for (const _ of segmenter.segment(text)) n++;
  return n;
}

/** Corta o texto em até `max` grafemas. */
function sliceGraphemes(text, max) {
  let out = '';
  let n = 0;
  for (const { segment } of segmenter.segment(text)) {
    if (n >= max) break;
    out += segment;
    n++;
  }
  return out;
}

/**
 * Divide um texto longo em partes de até `max` grafemas, quebrando em
 * parágrafos ou palavras, e numera as partes ("1/3") quando houver mais de uma.
 */
export function splitIntoThread(text, max = BLUESKY_MAX) {
  const clean = text.trim();
  if (graphemeLength(clean) <= max) return [clean];

  const reserve = 8; // espaço para " (10/10)"
  const limit = max - reserve;
  const words = clean.split(/(\s+)/); // mantém os espaços
  const parts = [];
  let current = '';

  for (const piece of words) {
    if (graphemeLength(current + piece) <= limit) {
      current += piece;
      continue;
    }
    if (current.trim()) parts.push(current.trim());
    current = piece.trimStart();
    // Palavra maior que o limite (ex.: um link enorme): corta na marra.
    while (graphemeLength(current) > limit) {
      const head = sliceGraphemes(current, limit);
      parts.push(head);
      current = current.slice(head.length);
    }
  }
  if (current.trim()) parts.push(current.trim());

  const total = parts.length;
  return parts.map((p, i) => `${p} (${i + 1}/${total})`);
}

const encoder = new TextEncoder();
const byteLen = (s) => encoder.encode(s).length;

/**
 * Gera os "facets" do Bluesky para links e hashtags, para que fiquem
 * clicáveis. As posições são em bytes UTF-8, como o protocolo exige.
 */
export function buildFacets(text) {
  const facets = [];

  const urlRe = /https?:\/\/[^\s<>"']+/g;
  for (const m of text.matchAll(urlRe)) {
    let url = m[0].replace(/[.,;:!?)\]]+$/, ''); // tira pontuação final
    const start = byteLen(text.slice(0, m.index));
    facets.push({
      index: { byteStart: start, byteEnd: start + byteLen(url) },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }],
    });
  }

  const tagRe = /(^|\s)(#[\p{L}\p{N}_]*\p{L}[\p{L}\p{N}_]*)/gu;
  for (const m of text.matchAll(tagRe)) {
    const tag = m[2];
    const offset = m.index + m[1].length;
    const start = byteLen(text.slice(0, offset));
    facets.push({
      index: { byteStart: start, byteEnd: start + byteLen(tag) },
      features: [{ $type: 'app.bsky.richtext.facet#tag', tag: tag.slice(1) }],
    });
  }

  return facets;
}
