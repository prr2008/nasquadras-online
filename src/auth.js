// Login simples do app: uma senha (APP_PASSWORD) gera um cookie assinado.

const COOKIE = 'nq_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 dias

const enc = new TextEncoder();

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Comparação em tempo constante, para não vazar a senha por tempo de resposta. */
export function safeEqual(a, b) {
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(/;\s*/)) {
    const [k, ...v] = part.split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export async function isLoggedIn(request, env) {
  const value = readCookie(request, COOKIE);
  if (!value || !env.SESSION_SECRET) return false;
  const [expires, sig] = value.split('.');
  if (!expires || !sig || Number(expires) < Date.now() / 1000) return false;
  return safeEqual(sig, await hmac(env.SESSION_SECRET, expires));
}

export async function sessionCookie(env) {
  const expires = Math.floor(Date.now() / 1000) + MAX_AGE;
  const sig = await hmac(env.SESSION_SECRET, String(expires));
  return `${COOKIE}=${expires}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
