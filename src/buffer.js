// Buffer: usado só como ponte para o X (Twitter). Ao agendar no app com "X"
// marcado, o post vai para a fila do Buffer no mesmo horário.
// API GraphQL: https://api.buffer.com (chave em publish.buffer.com/settings/api).

const API = 'https://api.buffer.com';

export const configured = (env) => Boolean(env.BUFFER_API_KEY && env.BUFFER_X_CHANNEL);

async function gql(env, query, variables) {
  if (!configured(env)) throw new Error('Buffer não configurado: cadastre BUFFER_API_KEY na Cloudflare.');
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.BUFFER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.errors?.length) {
    const msg = data.errors?.[0]?.message || `HTTP ${res.status}`;
    throw new Error(res.status === 401 ? 'Chave do Buffer inválida (BUFFER_API_KEY).' : `Buffer: ${msg}`);
  }
  return data.data;
}

/** Confere a chave e o canal do X sem publicar nada. */
export async function check(env) {
  if (!configured(env)) return { ok: false, error: 'BUFFER_API_KEY não cadastrada.' };
  try {
    const data = await gql(env, `query Check { channel(input: { id: ${JSON.stringify(env.BUFFER_X_CHANNEL)} }) { id service name } }`);
    const ch = data?.channel;
    if (!ch) return { ok: false, error: 'Canal do X não encontrado no Buffer.' };
    return { ok: true, service: ch.service, name: ch.name };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// O X aceita até 4 fotos ou 1 vídeo por post.
function assetsFor(media) {
  const video = media.find((m) => m.kind === 'video');
  if (video) return [{ video: { url: video.url } }];
  return media.slice(0, 4).map((m) => ({ image: { url: m.url } }));
}

async function createPost(env, input) {
  const data = await gql(env, `
    mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess { post { id dueAt } }
        ... on MutationError { message }
      }
    }`, { input: { channelId: env.BUFFER_X_CHANNEL, schedulingType: 'automatic', ...input } });
  const r = data?.createPost;
  if (!r?.post?.id) throw new Error(`Buffer: ${r?.message || 'não aceitou o post.'}`);
  return r.post.id;
}

/** Agenda no X pelo Buffer. Fotos/vídeo precisam de URL pública. */
export async function schedulePost(env, { text, dueAt, media = [] }) {
  return createPost(env, { text, assets: assetsFor(media), mode: 'customScheduled', dueAt: new Date(dueAt).toISOString() });
}

/** Publica no X agora, pelo Buffer (botão Publicar do Ao vivo). */
export async function postNow(env, { text, media = [] }) {
  return createPost(env, { text, assets: assetsFor(media), mode: 'shareNow' });
}

/** Remove da fila do Buffer (ao cancelar ou editar o agendamento). */
export async function deletePost(env, id) {
  if (!id) return;
  await gql(env, `
    mutation DeletePost($input: DeletePostInput!) {
      deletePost(input: $input) { __typename }
    }`, { input: { id } });
}
