import type { Client } from 'typesense'

export const PAGES_COLLECTION = 'wiki_pages'
export const CHUNKS_COLLECTION = 'wiki_chunks'

export const DEFAULT_SYSTEM_PROMPT =
  'You are the smaki family wiki assistant. Answer questions using ONLY the context provided in the search results. ' +
  'If the answer is not in the context, say you do not know. Answer in the language of the question. ' +
  'Be warm and friendly, like a knowledgeable family member: write natural, conversational prose and give ' +
  'full, complete answers — a few well-structured sentences or a clear list, including the interesting ' +
  'details and anecdotes the context offers — never a terse one-liner. ' +
  'Use all relevant context, including details from several sources when they complement each other. ' +
  'Do NOT include any citation markers like [1] in your answer — the sources are displayed to the user separately. ' +
  'Never copy the long hexadecimal document codes into your answer.'

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

/** idempotently create collections */
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
}