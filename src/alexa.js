// Skill "Nas Quadras" da Alexa, hospedada no próprio app (POST /alexa).
// A Amazon exige que cada pedido seja conferido antes de responder:
//   1. o endereço do certificado (SignatureCertChainUrl) é do S3 da Amazon, em /echo.api/;
//   2. o certificado está na validade, cobre echo-api.amazon.com e a cadeia fecha
//      numa autoridade conhecida;
//   3. a assinatura (Signature-256, RSA + SHA-256) confere com o corpo exato do pedido;
//   4. o horário do pedido tem no máximo 150 segundos de diferença;
//   5. o pedido é para a nossa skill (ID em ALEXA_SKILL_ID).
// Sem isso, a resposta é 400 e nada é lido.

import { X509Certificate } from 'node:crypto';
import * as briefing from './briefing.js';

const TOLERANCE_MS = 150 * 1000;
const CERT_CACHE = 'alexa:cert:';
/** Autoridades que podem estar no topo da cadeia da Amazon. */
export const TRUSTED_ROOTS = /(Amazon Root CA|DigiCert|Starfield|Amazon RSA 2048)/;

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Regra da Amazon para o endereço do certificado. */
export function validCertUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  const path = u.pathname.split('/').reduce((acc, seg) => {
    if (seg === '..') acc.pop(); else if (seg && seg !== '.') acc.push(seg);
    return acc;
  }, []);
  return u.protocol === 'https:'
    && u.hostname.toLowerCase() === 's3.amazonaws.com'
    && (u.port === '' || u.port === '443')
    && path[0] === 'echo.api';
}

function splitPem(pem) {
  return String(pem).match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
}

/** Confere a cadeia e devolve a chave pública (SPKI em DER) do certificado da Amazon. */
export function checkChain(pem, { now = Date.now(), roots = TRUSTED_ROOTS } = {}) {
  const certs = splitPem(pem).map((c) => new X509Certificate(c));
  if (!certs.length) throw new Error('certificado ausente');
  const leaf = certs[0];
  if (now < Date.parse(leaf.validFrom) || now > Date.parse(leaf.validTo)) throw new Error('certificado fora da validade');
  if (!/DNS:echo-api\.amazon\.com(,|$)/.test(String(leaf.subjectAltName || '').replace(/\s/g, ''))) throw new Error('certificado não é do echo-api.amazon.com');
  for (let i = 0; i < certs.length - 1; i++) {
    if (!certs[i].checkIssued(certs[i + 1]) || !certs[i].verify(certs[i + 1].publicKey)) throw new Error('cadeia de certificados inválida');
  }
  const top = certs[certs.length - 1];
  if (!roots.test(top.issuer)) throw new Error('autoridade desconhecida');
  return leaf.publicKey.export({ type: 'spki', format: 'der' });
}

async function publicKeyFor(env, url, { fetchImpl = fetch, now = Date.now(), roots } = {}) {
  const cached = env.KV ? await env.KV.get(`${CERT_CACHE}${url}`) : null;
  let spki;
  if (cached) {
    const c = JSON.parse(cached);
    if (now < c.validTo) spki = b64(c.spki);
  }
  if (!spki) {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`certificado: HTTP ${res.status}`);
    const pem = await res.text();
    spki = new Uint8Array(checkChain(pem, { now, roots }));
    const validTo = Date.parse(new X509Certificate(splitPem(pem)[0]).validTo);
    if (env.KV) {
      await env.KV.put(`${CERT_CACHE}${url}`, JSON.stringify({ spki: btoa(String.fromCharCode(...spki)), validTo }), { expirationTtl: 24 * 3600 });
    }
  }
  return crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

/** Lê e confere o pedido. Devolve o JSON do pedido ou lança erro. */
export async function verify(request, env, { fetchImpl, now = Date.now(), roots } = {}) {
  const certUrl = request.headers.get('SignatureCertChainUrl') || '';
  const sig = request.headers.get('Signature-256') || '';
  const raw = new Uint8Array(await request.arrayBuffer());
  if (!certUrl || !sig) throw new Error('pedido sem assinatura');
  if (!validCertUrl(certUrl)) throw new Error('endereço de certificado inválido');
  const key = await publicKeyFor(env, certUrl, { fetchImpl, now, roots });
  let sigBytes;
  try { sigBytes = b64(sig); } catch { throw new Error('assinatura ilegível'); }
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sigBytes, raw))) throw new Error('assinatura não confere');
  const body = JSON.parse(new TextDecoder().decode(raw));
  const ts = Date.parse(body?.request?.timestamp || '');
  if (!Number.isFinite(ts) || Math.abs(now - ts) > TOLERANCE_MS) throw new Error('pedido fora do horário');
  const appId = body?.context?.System?.application?.applicationId || body?.session?.application?.applicationId;
  if (env.ALEXA_SKILL_ID && appId !== env.ALEXA_SKILL_ID) throw new Error('pedido de outra skill');
  return body;
}

// ---------- Respostas ----------

const speak = (ssml, { end = true, reprompt = null, card = null } = {}) => ({
  version: '1.0',
  response: {
    outputSpeech: { type: 'SSML', ssml: ssml.startsWith('<speak>') ? ssml : `<speak>${ssml}</speak>` },
    ...(reprompt ? { reprompt: { outputSpeech: { type: 'SSML', ssml: `<speak>${reprompt}</speak>` } } } : {}),
    ...(card ? { card: { type: 'Simple', title: card.title, content: card.content.slice(0, 7900) } } : {}),
    shouldEndSession: end,
  },
});

const HELP = 'Eu leio os resultados da noite anterior do NBB e da NBA, com o cestinha de cada jogo. '
  + 'Você pode dizer: resultados de ontem; só a NBA; ou como foi o Flamengo. O que você quer ouvir?';

const slot = (intent, name) => {
  const s = intent?.slots?.[name];
  const res = s?.resolutions?.resolutionsPerAuthority?.find((r) => r.status?.code === 'ER_SUCCESS_MATCH');
  return res?.values?.[0]?.value?.name || s?.value || '';
};

/** Responde a um pedido já conferido. */
export async function handle(body, env, { getBriefing = () => briefing.get(env) } = {}) {
  const req = body.request || {};
  if (req.type === 'SessionEndedRequest') return { version: '1.0', response: {} };

  const intent = req.type === 'IntentRequest' ? req.intent?.name : 'LaunchRequest';
  if (intent === 'AMAZON.HelpIntent') return speak(HELP, { end: false, reprompt: 'Quer ouvir os resultados de ontem?' });
  if (intent === 'AMAZON.StopIntent' || intent === 'AMAZON.CancelIntent' || intent === 'AMAZON.NoIntent') return speak('Até a próxima, nas quadras!');
  if (intent === 'AMAZON.FallbackIntent') {
    return speak('Não entendi. ' + HELP, { end: false, reprompt: 'Quer ouvir os resultados de ontem?' });
  }

  let b;
  try { b = await getBriefing(); } catch (err) {
    console.error('alexa briefing', err);
    return speak('Não consegui buscar os resultados agora. Tente de novo daqui a pouco.');
  }
  const filters = intent === 'ResultadosIntent' || intent === 'TimeIntent'
    ? { league: slot(req.intent, 'liga'), team: slot(req.intent, 'time') }
    : {};
  const out = briefing.speech(b, filters);
  return speak(out.ssml, { card: { title: b.title || 'Nas Quadras', content: out.text } });
}
