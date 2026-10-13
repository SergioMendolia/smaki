import MarkdownIt from 'markdown-it'
import { requireUser } from '../utils/auth'
import { answerQuestionStream, type RagTurn } from '../utils/rag'

// html: false — raw HTML in LLM answers is escaped, only markdown is rendered
const md = new MarkdownIt({ html: false, linkify: true, breaks: true })

interface HistoryTurn {
  role?: unknown
  text?: unknown
}

/**
 * RAG: hybrid retrieval from typesense + streaming LLM answer, orchestrated
 * in-app. Responds with newline-delimited JSON events:
 *   {"type":"sources","sources":[…]}  — before generation starts
 *   {"type":"delta","text":"…"}        — answer chunks as they arrive
 *   {"type":"done","html":"…"}        — final markdown-rendered answer
 *   {"type":"error","message":"…"}     — mid-stream failure
 */
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

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      try {
        const { sources, stream: answer } = await answerQuestionStream(q, history, scope)
        send({ type: 'sources', sources })
        let text = ''
        for await (const chunk of answer) {
          text += chunk
          send({ type: 'delta', text: chunk })
        }
        send({ type: 'done', html: md.render(text) })
      } catch (error: any) {
        // a scoped folder whose collections don't exist yet is not an error
        if (scope && (error?.httpStatus === 404 || String(error?.message ?? '').includes('404'))) {
          const message = 'Nothing in this folder matches your question.'
          send({ type: 'sources', sources: [] })
          send({ type: 'delta', text: message })
          send({ type: 'done', html: md.render(message) })
        } else {
          const e = error as { statusMessage?: string, message?: string }
          send({ type: 'error', message: `RAG query failed: ${e?.statusMessage || e?.message || String(error)}` })
        }
      }
      controller.close()
    }
  })

  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache' } })
})