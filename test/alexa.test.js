// Skill da Alexa: verificação dos pedidos assinados e respostas.
// Os certificados em test/fixtures/alexa são de teste (gerados com openssl),
// imitando a cadeia da Amazon: "echo-api.amazon.com" emitido por uma raiz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import * as alexa from '../src/alexa.js';
import * as briefing from '../src/briefing.js';

const fx = (f) => readFileSync(new URL(`./fixtures/alexa/${f}`, import.meta.url), 'utf8');
const CHAIN = fx('leaf.pem') + fx('root.pem');
const OTHER = fx('other.pem') + fx('root.pem');
const ROOTS = /Test Root CA/;
const CERT_URL = 'https://s3.amazonaws.com/echo.api/echo-api-cert.pem';
const SKILL = 'amzn1.ask.skill.test';
const NOW = Date.parse('2026-11-17T10:00:00Z');

function signed(body, { key = fx('leaf.key'), url = CERT_URL, tamper = false } = {}) {
  const raw = JSON.stringify(body);
  const sig = createSign('RSA-SHA256').update(raw).sign(key, 'base64');
  return new Request('https://nasquadras.online/alexa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', SignatureCertChainUrl: url, 'Signature-256': sig },
    body: tamper ? raw.replace('Launch', 'Lunch') : raw,
  });
}
const launch = (ts = '2026-11-17T10:00:30Z', app = SKILL) => ({
  version: '1.0',
  context: { System: { application: { applicationId: app } } },
  request: { type: 'LaunchRequest', requestId: 'r1', timestamp: ts, locale: 'pt-BR' },
});
const env = { ALEXA_SKILL_ID: SKILL };
const fetchCert = (pem) => async () => new Response(pem);

test('endereço do certificado: só o S3 da Amazon em /echo.api/', () => {
  assert.ok(alexa.validCertUrl('https://s3.amazonaws.com/echo.api/echo-api-cert.pem'));
  assert.ok(alexa.validCertUrl('https://s3.amazonaws.com:443/echo.api/../echo.api/echo-api-cert.pem'));
  assert.ok(!alexa.validCertUrl('http://s3.amazonaws.com/echo.api/echo-api-cert.pem'));
  assert.ok(!alexa.validCertUrl('https://notamazon.com/echo.api/echo-api-cert.pem'));
  assert.ok(!alexa.validCertUrl('https://s3.amazonaws.com/EcHo.aPi/echo-api-cert.pem'));
  assert.ok(!alexa.validCertUrl('https://s3.amazonaws.com:563/echo.api/echo-api-cert.pem'));
  assert.ok(!alexa.validCertUrl('https://s3.amazonaws.com/invalid.path/echo-api-cert.pem'));
});

test('pedido assinado corretamente é aceito', async () => {
  const body = await alexa.verify(signed(launch()), env, { fetchImpl: fetchCert(CHAIN), now: NOW, roots: ROOTS });
  assert.equal(body.request.type, 'LaunchRequest');
});

test('recusa: corpo alterado, horário velho, outra skill, certificado de outro site, autoridade desconhecida', async () => {
  const opts = { fetchImpl: fetchCert(CHAIN), now: NOW, roots: ROOTS };
  await assert.rejects(alexa.verify(signed(launch(), { tamper: true }), env, opts), /assinatura não confere/);
  await assert.rejects(alexa.verify(signed(launch('2026-11-17T09:50:00Z')), env, opts), /fora do horário/);
  await assert.rejects(alexa.verify(signed(launch(undefined, 'amzn1.ask.skill.outra')), env, opts), /outra skill/);
  await assert.rejects(alexa.verify(signed(launch(), { key: fx('other.key') }), env, { ...opts, fetchImpl: fetchCert(OTHER) }), /echo-api\.amazon\.com/);
  await assert.rejects(alexa.verify(signed(launch()), env, { ...opts, roots: /Amazon Root CA/ }), /autoridade desconhecida/);
  await assert.rejects(alexa.verify(signed(launch(), { url: 'https://evil.com/echo.api/c.pem' }), env, opts), /endereço de certificado/);
  const noSig = new Request('https://x/alexa', { method: 'POST', body: '{}' });
  await assert.rejects(alexa.verify(noSig, env, opts), /sem assinatura/);
});

const b = {
  date: '2026-11-16',
  title: 'Nas Quadras: resultados de segunda-feira, 16 de novembro',
  nbb: [{ league: 'NBB', home: 'Flamengo', away: 'Franca', homeScore: 88, awayScore: 80, final: true, top: { name: 'Gui Deodato', team: 'Flamengo', pts: 22 } }],
  nba: [{ league: 'NBA', home: 'Lakers', away: 'Denver', homeNick: 'Lakers', awayNick: 'Nuggets', homeScore: 110, awayScore: 104, final: true, top: null }],
};
Object.assign(b, briefing.compose(b));
const getBriefing = async () => b;
const intent = (name, slots = {}) => ({ request: { type: 'IntentRequest', intent: { name, slots: Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, { name: k, value: v }])) } } });
const said = (r) => r.response.outputSpeech.ssml;

test('abrir a skill lê o resumo inteiro e encerra', async () => {
  const r = await alexa.handle({ request: { type: 'LaunchRequest' } }, env, { getBriefing });
  assert.match(said(r), /Resultados de segunda-feira, 16 de novembro/);
  assert.match(said(r), /Flamengo venceu Franca/);
  assert.equal(r.response.shouldEndSession, true);
  assert.equal(r.response.card.type, 'Simple');
});

test('filtros: só a NBA, um time pelo apelido, time sem jogo', async () => {
  const nba = said(await alexa.handle(intent('ResultadosIntent', { liga: 'NBA' }), env, { getBriefing }));
  assert.match(nba, /Na NBA/); assert.ok(!/NBB/.test(nba));
  const nuggets = said(await alexa.handle(intent('TimeIntent', { time: 'Nuggets' }), env, { getBriefing }));
  assert.match(nuggets, /Lakers.*venceu.*Denver/);
  const none = said(await alexa.handle(intent('TimeIntent', { time: 'Bauru' }), env, { getBriefing }));
  assert.match(none, /Não encontrei jogo do Bauru nessa noite/);
});

test('ajuda mantém a conversa aberta; parar encerra; fim de sessão responde vazio', async () => {
  const h = await alexa.handle(intent('AMAZON.HelpIntent'), env, { getBriefing });
  assert.equal(h.response.shouldEndSession, false);
  assert.ok(h.response.reprompt);
  const s = await alexa.handle(intent('AMAZON.StopIntent'), env, { getBriefing });
  assert.match(said(s), /Até a próxima/);
  assert.deepEqual(await alexa.handle({ request: { type: 'SessionEndedRequest' } }, env, { getBriefing }), { version: '1.0', response: {} });
});
