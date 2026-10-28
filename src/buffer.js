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

/** Agenda no X pelo Buffer. Fotos/vídeo precisam de URL pública. */
export async function schedulePost(env, { text, dueAt, media = [] }) {
  const assets = media.slice(0, 4).map((m) => (m.kind === 'video' ? { video: { url: m.url } } : { image: { url: m.url } }));
  const data = await gql(env, `
    mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess { post { id dueAt } }
        ... on MutationError { message }
      }
    }`, {
    input: {
      channelId: env.BUFFER_X_CHANNEL,
      text,
      assets,
      schedulingType: 'automatic',
      mode: 'customScheduled',
      dueAt: new Date(dueAt).toISOString(),
    },
  });
  const r = data?.createPost;
  if (!r?.post?.id) throw new Error(`Buffer: ${r?.message || 'não aceitou o post.'}`);
  return r.post.id;
}

/** Remove da fila do Buffer (ao cancelar ou editar o agendamento). */
export async function deletePost(env, id) {
  if (!id) return;
  await gql(env, `
    mutation DeletePost($input: DeletePostInput!) {
      deletePost(input: $input) { __typename }
    }`, { input: { id } });
}
