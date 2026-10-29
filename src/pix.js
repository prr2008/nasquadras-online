// Pix estático (BR Code "copia e cola") e o QR Code em SVG, para a caixa "Apoie".
// Formato do Banco Central: campos ID + tamanho (2 dígitos) + valor, CRC16 no fim.
import qrcode from 'qrcode-generator';

const field = (id, value) => `${id}${String(value.length).padStart(2, '0')}${value}`;

/** Sem acentos e só com caracteres aceitos pelos bancos. */
const plain = (s, max) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9 .-]/g, '').trim().slice(0, max);

/** CRC16-CCITT (polinômio 0x1021, início 0xFFFF), em 4 dígitos hexadecimais. */
export function crc16(str) {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(str)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Código "copia e cola" de um Pix sem valor fixo (o doador escolhe o valor). */
export function brCode({ key, name, city, message = '' }) {
  const account = field('00', 'br.gov.bcb.pix') + field('01', key) + (message ? field('02', plain(message, 40)) : '');
  const payload = [
    field('00', '01'),
    field('26', account),
    field('52', '0000'),
    field('53', '986'),
    field('58', 'BR'),
    field('59', plain(name, 25) || 'Nas Quadras'),
    field('60', plain(city, 15) || 'Rio de Janeiro'),
    field('62', field('05', '***')),
    '6304',
  ].join('');
  return payload + crc16(payload);
}

export function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

let cache = null;
/** Dados da caixa "Apoie" a partir da configuração (PIX_KEY, PIX_NAME, PIX_CITY, KOFI_URL). */
export function supportInfo(env) {
  const sig = [env.PIX_KEY, env.PIX_NAME, env.PIX_CITY, env.KOFI_URL].join('|');
  if (cache?.sig === sig) return cache.info;
  const key = String(env.PIX_KEY || '').trim();
  let pix = null;
  if (key) {
    const code = brCode({ key, name: env.PIX_NAME || 'Pedro Rodrigues', city: env.PIX_CITY, message: 'Apoio Nas Quadras' });
    pix = { key, code, svg: qrSvg(code) };
  }
  const info = { kofi: env.KOFI_URL || null, pix };
  cache = { sig, info };
  return info;
}
