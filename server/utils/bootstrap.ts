import type { Client } from 'typesense'

export const PAGES_COLLECTION = 'wiki_pages'
export const CHUNKS_COLLECTION = 'wiki_chunks'
export const HISTORY_COLLECTION = 'conversation_store'
export const CONVERSATION_MODEL_ID = 'smaki'

export const DEFAULT_SYSTEM_PROMPT =
  'You are the smaki family wiki assistant. Answer questions using ONLY the context provided in the search results. ' +
  'If the answer is not in the context, say you do not know. Answer in the language of the question. ' +
  'Be helpful and complete: give thorough, well-structured answers — short paragraphs or a clear list when it helps — ' +
  'rather than one terse sentence. Use all relevant context, including details from several sources when they complement each other. ' +
  'You may mention the page paths of the sources you used, ' +
  'but never copy the long hexadecimal document codes into your answer.'

function is404(error: unknown): boolean {
  const e = error as { httpStatus?: number, message?: string }
  return e?.httpStatus === 404 || String(e?.message ?? '').includes('404')
}

/** strip trailing slashes and /v1 — typesense appends its own default api path */
function normalizeBaseUrl(raw: string): string {
  let url = raw.replace(/\/+$/, '')
  if (url.endsWith('/v1')) url = url.slice(0, -3)
  return url
}

/** embedding field config: built-in ts/ models (default) or any OpenAI-compatible endpoint */
function embeddingField(from: string[]) {
  const config = useRuntimeConfig()
  const model = config.embeddingModel || 'ts/e5-small'
  const modelConfig: Record<string, string> = { model_name: model }
  if (config.embeddingUrl) {
    modelConfig.model_name = model.includes('/') ? model : `openai/${model}`
    modelConfig.url = normalizeBaseUrl(config.embeddingUrl)
    if (config.embeddingApiKey) modelConfig.api_key = config.embeddingApiKey
  }
  return { name: 'embedding', type: 'float[]', embed: { from, model_config: modelConfig } }
}

async function ensureCollection(client: Client, name: string, schema: Record<string, unknown>) {
  const fields = (schema.fields ?? []) as Array<Record<string, any>>
  const wantEmbed = fields.find(f => f.name === 'embedding')?.embed?.model_config
  try {
    const existing = (await client.collections(name).retrieve()) as Record<string, any>
    const haveEmbed = (existing.fields ?? []).find((f: Record<string, any>) => f.name === 'embedding')
      ?.embed?.model_config
    // schema drift (e.g. embedding model switched): the old collection can't
    // serve hybrid queries anymore — drop it, clear sync state, recreate below.
    // collections without an embedding field are fine as they are.
    if (!wantEmbed && !haveEmbed) return
    const same = wantEmbed?.model_name === haveEmbed?.model_name && wantEmbed?.url === haveEmbed?.url
    if (same) return
    await client.collections(name).delete()
    const db = useDb()
    if (name === PAGES_COLLECTION) db.delete(tables.pages).run()
    if (name === CHUNKS_COLLECTION) db.delete(tables.files).run()
    console.log(`[smaki] typesense: embedding config changed — recreating collection ${name}`)
  } catch (error) {
    if (!is404(error)) throw error
  }
  await client.collections().create(schema as never)
  console.log(`[smaki] typesense: created collection ${name}`)
}

async function ensureConversationModel(client: Client) {
  const config = useRuntimeConfig()
  if (!config.llmModel) {
    console.warn('[smaki] NUXT_LLM_MODEL not set — RAG chat disabled, search still works')
    return
  }
  // typesense needs the openai/ prefix to route via openai_url; it strips it
  // before calling the endpoint. Without it, namespaced models (google/…,
  // meta/…) fall through to the native gemini provider.
  const model = /^(openai|vllm)\//.test(config.llmModel) ? config.llmModel : `openai/${config.llmModel}`
  const body: Record<string, unknown> = {
    id: CONVERSATION_MODEL_ID,
    model_name: model,
    history_collection: HISTORY_COLLECTION,
    api_key: config.llmApiKey || 'not-needed',
    system_prompt: config.llmSystemPrompt || DEFAULT_SYSTEM_PROMPT,
    max_bytes: Number(config.llmMaxBytes) || 16384
  }
  if (config.llmUrl) {
    if (model.startsWith('vllm/')) body.vllm_url = config.llmUrl
    else body.openai_url = normalizeBaseUrl(config.llmUrl)
  }
  try {
    const existing = (await client
      .conversations()
      .models(CONVERSATION_MODEL_ID)
      .retrieve()) as unknown as Record<string, unknown>
    // recreate the model when the configured LLM, endpoint, prompt or context size changes
    if (
      existing.model_name !== model ||
      (body.openai_url && existing.openai_url !== body.openai_url) ||
      (body.system_prompt && existing.system_prompt !== body.system_prompt) ||
      (body.max_bytes && existing.max_bytes !== body.max_bytes)
    ) {
      await client.conversations().models(CONVERSATION_MODEL_ID).delete()
      await client.conversations().models().create(body as never)
      console.log(`[smaki] typesense: updated conversation model ${CONVERSATION_MODEL_ID} (${model})`)
      return
    }
  } catch (error) {
    if (!is404(error)) throw error
    await client.conversations().models().create(body as never)
    console.log(`[smaki] typesense: created conversation model ${CONVERSATION_MODEL_ID} (${model})`)
  }
}

/** idempotently create collections + conversation model */
export async function ensureTypesense(): Promise<void> {
  const client = useTypesense()

  await ensureCollection(client, PAGES_COLLECTION, {
    name: PAGES_COLLECTION,
    fields: [
      { name: 'path', type: 'string' },
      { name: 'title', type: 'string' },
      { name: 'description', type: 'string', optional: true },
      { name: 'content', type: 'string' },
      embeddingField(['title', 'content'])
    ]
  })

  await ensureCollection(client, CHUNKS_COLLECTION, {
    name: CHUNKS_COLLECTION,
    fields: [
      { name: 'file_id', type: 'string' },
      { name: 'page_path', type: 'string', facet: true },
      { name: 'filename', type: 'string' },
      { name: 'chunk_index', type: 'int32' },
      // infix so queries can match inside glued words of broken text layers
      // (e.g. "dudocument" for "document") — only used as a fallback at query time
      { name: 'content', type: 'string', infix: true },
      embeddingField(['filename', 'content'])
    ]
  })

  await ensureCollection(client, HISTORY_COLLECTION, {
    name: HISTORY_COLLECTION,
    fields: [
      { name: 'conversation_id', type: 'string' },
      { name: 'model_id', type: 'string' },
      { name: 'timestamp', type: 'int32' },
      { name: 'role', type: 'string', index: false },
      { name: 'message', type: 'string', index: false }
    ]
  })

  await ensureConversationModel(client)
}