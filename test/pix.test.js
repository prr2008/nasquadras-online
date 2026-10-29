import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brCode, crc16, supportInfo } from '../src/pix.js';

test('CRC16 do exemplo padrão', () => {
  assert.equal(crc16('123456789'), '29B1');
});

test('BR Code com campos no formato do Banco Central', () => {
  const c = brCode({ key: 'chave@exemplo.com', name: 'Pedro Rodrigues', city: 'São Paulo' });
  assert.ok(c.startsWith('000201'));
  assert.ok(c.includes('0014br.gov.bcb.pix0117chave@exemplo.com'));
  assert.ok(c.includes('5303986') && c.includes('5802BR'));
  assert.ok(c.includes('5915Pedro Rodrigues') && c.includes('6009Sao Paulo'));
  assert.equal(c.slice(-4), crc16(c.slice(0, -4)));
});

test('sem configuração, nada aparece', () => {
  assert.deepEqual(supportInfo({}), { kofi: null, pix: null });
  const s = supportInfo({ KOFI_URL: 'https://ko-fi.com/x', PIX_KEY: 'a@b.com' });
  assert.ok(s.pix.svg.startsWith('<svg'));
});
