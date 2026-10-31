// Prévia de link no editor do Ao vivo: segue encurtadores (bit.ly etc.) até a
// página final e lê título, descrição e imagem (Open Graph), como as redes
// fazem no card. Também entrega a imagem para virar foto do post.

import { decodeHtml, pageMeta, THUMB_MAX, UA } from './bluesky.js';

const IMAGE_MAX = 15 * 1024 * 1024;

export function validUrl(input) {
  let u;
  try { u = new URL(String(input || '').trim()); } catch { throw new Error('Link inválido.'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Link inválido.');
  return u.toString();
}

/** Tamanho da imagem (para avisar quando o Bluesky vai mandar o card sem ela). */
async function imageSize(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    const type = (r.headers.get('Content-Type') || '').split(';')[0];
    const len = Number(r.headers.get('Content-Length')) || (await r.arrayBuffer()).byteLength;
    return { ok: r.ok && type.startsWith('image/'), bytes: len };
  } catch {
    return { ok: false, bytes: 0 };
  }
}

export async function preview(input) {
  const url = validUrl(input);
  let m = null;
  try { m = await pageMeta(url); } catch { m = null; }
  if (!m) return { url, ok: false, error: 'Não consegui ler a página do link (o site pode bloquear a leitura automática). As redes também podem não mostrar o card.' };
  const finalUrl = m.finalUrl || url;
  let image = m.image && /^https:\/\//.test(m.image) ? m.image : null;
  let imageTooBig = false;
  if (image) {
    const s = await imageSize(image);
    if (!s.ok) image = null;
    else imageTooBig = s.bytes > THUMB_MAX;
  }
  return {
    url,
    ok: true,
    finalUrl,
    host: new URL(finalUrl).hostname.replace(/^www\./, ''),
    shortened: new URL(finalUrl).hostname !== new URL(url).hostname,
    title: decodeHtml(m.title).slice(0, 300),
    description: decodeHtml(m.description).slice(0, 300),
    image,
    imageTooBig,
  };
}

/** Baixa a imagem da prévia (o navegador não consegue direto por causa do CORS). */
export async function image(input) {
  const url = validUrl(input);
  if (!url.startsWith('https://')) throw new Error('Imagem precisa ser https.');
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  const type = (r.headers.get('Content-Type') || '').split(';')[0];
  if (!r.ok || !/^image\/(jpeg|png|webp|gif)$/.test(type)) throw new Error('Não consegui baixar a imagem.');
  const buf = await r.arrayBuffer();
  if (buf.byteLength > IMAGE_MAX) throw new Error('Imagem grande demais.');
  return new Response(buf, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=300' } });
}
