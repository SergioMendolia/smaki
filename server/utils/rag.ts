import { CHUNKS_COLLECTION, DEFAULT_SYSTEM_PROMPT, PAGES_COLLECTION } from './bootstrap'
import { llmChat, type LlmMessage } from './llm'
import { useTypesense } from './typesense'

export interface RagSource {
  type: 'page' | 'chunk'
  path: string
  title?: string
  filename?: string
}

/** one turn of chat history, in chronological order */
export interface RagTurn {
  role: 'user' | 'assistant'
  content: string
}

interface RawHit {
  document?: Record<string, any>
}

interface ContextEntry {
  source: RagSource
  text: string
}

/** max characters of a single hit fed to the LLM */
const MAX_ENTRY_CHARS = 6000
/** stop adding context entries once less than this fits */
const MIN_REMAINING_CHARS = 500
/** chunks kept per document */
const MAX_CHUNKS_PER_FILE = 2

/**
 * When the question refers to the conversation ("and what about his sister?"),
 * rewrite it into a standalone query using the history. Returns the original
 * question on any failure — retrieval then simply tries its luck with it.
 */
export async function rewriteQuery(q: string, history: RagTurn[]): Promise<string> {
  if (!history.length) return q
  const messages: LlmMessage[] = [
    {
      role: 'system',
      content:
        'Rewrite the user question into a standalone search query for a family wiki. ' +
        'Resolve pronouns and references using the conversation history. ' +
        'Reply with the search query ONLY — no quotes, no explanation.'
    },
    ...history.slice(-8).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: q }
  ]
  try {
    const rewritten = await llmChat(messages, { maxTokens: 100 })
    const clean = rewritten.trim().replace(/^["'`]+|["'`]+$/g, '').slice(0, 500)
    return clean || q
  } catch {
    return q
  }
}

/** hybrid (lexical + semantic) retrieval across pages and document chunks */
export async function retrieve(q: string, scope: string): Promise<{ pageHits: RawHit[], chunkHits: RawHit[] }> {
  const filterBy = scope ? `:=[${scope},${scope}*]` : undefined
  // remote embedders (openai-compatible) don't support prefix search
  const prefixParams = useRuntimeConfig().embeddingUrl ? { prefix: false } : {}
  const res: any = await useTypesense().multiSearch.perform({
    searches: [
      {
        collection: PAGES_COLLECTION,
        q,
        query_by: 'title,content,embedding',
        exclude_fields: 'embedding',
        ...(filterBy ? { filter_by: `path${filterBy}` } : {}),
        ...prefixParams,
        per_page: 10
      },
      {
        collection: CHUNKS_COLLECTION,
        q,
        query_by: 'filename,content,embedding',
        exclude_fields: 'embedding',
        infix: 'fallback',
        ...(filterBy ? { filter_by: `page_path${filterBy}` } : {}),
        ...prefixParams,
        per_page: 20
      }
    ]
  })
  return {
    pageHits: (res.results?.[0]?.hits ?? []) as RawHit[],
    chunkHits: (res.results?.[1]?.hits ?? []) as RawHit[]
  }
}

/**
 * Merge retrieval hits into a numbered context: pages first, then at most
 * MAX_CHUNKS_PER_FILE document chunks each, trimmed to the given char budget.
 */
export function buildContext(
  pageHits: RawHit[],
  chunkHits: RawHit[],
  budget: number
): ContextEntry[] {
  const entries: ContextEntry[] = []
  for (const hit of pageHits) {
    if (!hit.document?.path) continue
    entries.push({
      source: { type: 'page', path: hit.document.path, title: hit.document.title },
      text: String(hit.document.content ?? '')
    })
  }
  const perFile = new Map<string, number>()
  for (const hit of chunkHits) {
    const doc = hit.document ?? {}
    const id = String(doc.file_id ?? '')
    const count = perFile.get(id) ?? 0
    if (count >= MAX_CHUNKS_PER_FILE) continue
    perFile.set(id, count + 1)
    entries.push({
      source: {
        type: 'chunk',
        path: String(doc.page_path ?? ''),
        filename: doc.filename
      },
      text: String(doc.content ?? '')
    })
  }

  const kept: ContextEntry[] = []
  let remaining = budget
  for (const entry of entries) {
    if (remaining < MIN_REMAINING_CHARS) break
    const text = entry.text.slice(0, Math.min(MAX_ENTRY_CHARS, remaining))
    if (!text.trim()) continue
    remaining -= text.length
    kept.push({ source: entry.source, text })
  }
  return kept
}

function contextBlock(entries: ContextEntry[]): string {
  return entries
    .map((entry, i) => {
      const label =
        entry.source.type === 'page'
          ? `[${i + 1}] Page ${entry.source.path}${entry.source.title ? ` — ${entry.source.title}` : ''}`
          : `[${i + 1}] Document ${entry.source.path ? `${entry.source.path}/` : ''}${entry.source.filename ?? ''} — passage`
      return `${label}\n${entry.text}`
    })
    .join('\n\n')
}

/** full RAG pipeline: rewrite → retrieve → assemble context → answer */
export async function answerQuestion(
  q: string,
  history: RagTurn[],
  scope: string
): Promise<{ answer: string, sources: RagSource[] }> {
  const searchQuery = await rewriteQuery(q, history)
  const { pageHits, chunkHits } = await retrieve(searchQuery, scope)
  const budget = Number(useRuntimeConfig().llmMaxBytes) || 65536
  const entries = buildContext(pageHits, chunkHits, budget)

  if (!entries.length) {
    return {
      answer: scope
        ? 'Nothing in this folder matches your question.'
        : 'Nothing in the wiki matches your question.',
      sources: []
    }
  }

  const config = useRuntimeConfig()
  const messages: LlmMessage[] = [
    { role: 'system', content: config.llmSystemPrompt || DEFAULT_SYSTEM_PROMPT },
    ...history.slice(-10).map(m => ({ role: m.role, content: m.content })),
    {
      role: 'user',
      content:
        `Search results from the family wiki:\n\n${contextBlock(entries)}\n\n` +
        'Question: ' + q
    }
  ]
  // the sources are rendered separately as links — strip any citation
  // markers the LLM left in the answer text
  const answer = (await llmChat(messages)).replace(/\s*\[\d{1,2}\]/g, '')
  return { answer, sources: entries.map(e => e.source) }
}