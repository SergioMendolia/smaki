import MarkdownIt from 'markdown-it'
import { requireUser } from '../utils/auth'
import { answerQuestion, type RagTurn } from '../utils/rag'

// html: false — raw HTML in LLM answers is escaped, only markdown is rendered
const md = new MarkdownIt({ html: false, linkify: true, breaks: true })

interface HistoryTurn {
  role?: unknown
  text?: unknown
}

/** RAG: hybrid retrieval from typesense + LLM answer, orchestrated in-app */
export default defineEventHandler(async (event) => {
  requireUser(event)
  const body = await readBody<{ q?: string, history?: HistoryTurn[], scope?: string }>(event)
  const q = body.q?.trim() ?? ''
  if (!q) {
    throw createError({ statusCode: 400, statusMessage: 'A question is required' })
  }
  const config = useRuntimeConfig()
  if (!config.llmModel) {
    throw createError({ statusCode: 503, statusMessage: 'RAG chat is not configured: set NUXT_LLM_MODEL (and NUXT_LLM_URL)' })
  }

  // conversation history comes from the client (kept in the chat store) —
  // it is used for query rewriting and as LLM chat context
  const history: RagTurn[] = (body.history ?? [])
    .filter(m => (m?.role === 'user' || m?.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
    .slice(-10)
    .map(m => ({ role: m.role as 'user' | 'assistant', content: (m.text as string).slice(0, 8000) }))

  // folder scope: restrict retrieval to the folder's pages and documents
  // ('' or missing = whole wiki)
  const scope = typeof body.scope === 'string' ? body.scope.trim() : ''

  try {
    const { answer, sources } = await answerQuestion(q, history, scope)
    return { answer, answer_html: md.render(answer), sources }
  } catch (error: any) {
    // collections may not exist yet during bootstrap — a scoped folder with
    // no hits is not an error
    if (scope && (error?.httpStatus === 404 || String(error?.message ?? '').includes('404'))) {
      const answer = 'Nothing in this folder matches your question.'
      return { answer, answer_html: md.render(answer), sources: [] }
    }
    const e = error as { statusMessage?: string, message?: string }
    throw createError({
      statusCode: 502,
      statusMessage: `RAG query failed: ${e?.statusMessage || e?.message || String(error)}`
    })
  }
})