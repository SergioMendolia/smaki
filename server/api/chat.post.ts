import { CONVERSATION_MODEL_ID, CHUNKS_COLLECTION, PAGES_COLLECTION } from '../utils/bootstrap'
import { requireUser } from '../utils/auth'
import { useTypesense } from '../utils/typesense'

export interface ChatSource {
  type: 'page' | 'chunk'
  path: string
  title?: string
  filename?: string
}

/** RAG: typesense conversational search with the configured LLM */
export default defineEventHandler(async (event) => {
  requireUser(event)
  const body = await readBody<{ q?: string, conversation_id?: string, scope?: string }>(event)
  const q = body.q?.trim() ?? ''
  if (!q) {
    throw createError({ statusCode: 400, statusMessage: 'A question is required' })
  }
  const config = useRuntimeConfig()
  if (!config.llmModel) {
    throw createError({ statusCode: 503, statusMessage: 'RAG chat is not configured: set NUXT_LLM_MODEL (and NUXT_LLM_URL)' })
  }

  // folder scope: restrict retrieval to the folder's pages and documents
  // ('' or missing = whole wiki). [scope,scope*] matches the folder and descendants.
  const scope = typeof body.scope === 'string' ? body.scope.trim() : ''
  const filterBy = scope ? `:=[${scope},${scope}*]` : undefined

  // for conversational search, `q` must be a common query parameter, not inside each search body
  const params: Record<string, string> = {
    q,
    conversation: 'true',
    conversation_model_id: CONVERSATION_MODEL_ID
  }
  if (body.conversation_id) params.conversation_id = body.conversation_id
  // remote embedders (openai-compatible) don't support prefix search
  const prefixParams = useRuntimeConfig().embeddingUrl ? { prefix: false } : {}

  let res: any
  try {
    res = await useTypesense().multiSearch.perform(
      {
        searches: [
          {
            collection: PAGES_COLLECTION,
            query_by: 'title,content,embedding',
            exclude_fields: 'embedding',
            ...(filterBy ? { filter_by: `path${filterBy}` } : {}),
            ...prefixParams,
            per_page: 8
          },
          {
            collection: CHUNKS_COLLECTION,
            query_by: 'filename,content,embedding',
            exclude_fields: 'embedding',
            infix: 'fallback',
            ...(filterBy ? { filter_by: `page_path${filterBy}` } : {}),
            ...prefixParams,
            per_page: 8
          }
        ]
      },
      params as never
    )
  } catch (error: any) {
    // a scoped folder with no LLM-relevant hits is not an error
    if (filterBy && [400, 404].includes(error?.httpStatus ?? 0)) {
      return {
        answer: 'Nothing in this folder matches your question.',
        conversation_id: body.conversation_id ?? '',
        sources: []
      }
    }
    const e = error as { message?: string }
    throw createError({ statusCode: 502, statusMessage: `RAG query failed: ${e?.message ?? String(error)}` })
  }

  const conversation = res.conversation
  if (!conversation?.answer) {
    throw createError({
      statusCode: 502,
      statusMessage: 'No answer from the conversation model — check NUXT_LLM_* settings and that the LLM endpoint is reachable'
    })
  }

  const sources: ChatSource[] = []
  const seen = new Set<string>()
  const push = (source: ChatSource) => {
    const key = `${source.type}:${source.path}:${source.filename ?? ''}`
    if (source.path !== undefined && !seen.has(key)) {
      seen.add(key)
      sources.push(source)
    }
  }
  for (const hit of res.results?.[0]?.hits ?? []) {
    if (sources.filter(s => s.type === 'page').length >= 10) break
    push({ type: 'page', path: hit.document?.path, title: hit.document?.title })
  }
  for (const hit of res.results?.[1]?.hits ?? []) {
    if (sources.filter(s => s.type === 'chunk').length >= 8) break
    push({ type: 'chunk', path: hit.document?.page_path, filename: hit.document?.filename })
  }

  return {
    answer: conversation.answer,
    conversation_id: conversation.conversation_id,
    sources
  }
})