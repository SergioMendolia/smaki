import { CHUNKS_COLLECTION, PAGES_COLLECTION } from '../utils/bootstrap'
import { requireUser } from '../utils/auth'
import { useTypesense } from '../utils/typesense'

interface RawHit {
  document?: Record<string, any>
  highlight?: Record<string, any>
  text_match?: number
  vector_distance?: number
}

function snippetOf(hit: RawHit): string {
  const content = hit?.highlight?.content
  const snippet = Array.isArray(content?.snippets) ? content.snippets[0] : content?.snippet
  return (typeof snippet === 'string' ? snippet : String(hit?.document?.content ?? '').slice(0, 300))
}

function hitScore(hit: RawHit): number {
  // lexical match dominates; closer vectors break ties
  return Number(hit.text_match ?? 0) * 1000 - Number(hit.vector_distance ?? 1)
}

/** hybrid (lexical + semantic) search across pages and document chunks */
export default defineEventHandler(async (event) => {
  requireUser(event)
  const q = String(getQuery(event).q ?? '').trim()
  if (!q) return { pages: [], chunks: [] }

  // remote embedders (openai-compatible) don't support prefix search
  const prefixParams = useRuntimeConfig().embeddingUrl ? { prefix: false } : {}

  try {
    const res: any = await useTypesense().multiSearch.perform({
      searches: [
        {
          collection: PAGES_COLLECTION,
          q,
          query_by: 'title,content,embedding',
          exclude_fields: 'embedding',
          ...prefixParams,
          per_page: 10
        },
        {
          collection: CHUNKS_COLLECTION,
          q,
          query_by: 'filename,content,embedding',
          exclude_fields: 'embedding',
          infix: 'fallback',
          ...prefixParams,
          per_page: 20
        }
      ]
    })
    const [pagesRes, chunksRes] = res.results ?? []
    const pageHits: RawHit[] = pagesRes?.hits ?? []
    const chunkHits: RawHit[] = chunksRes?.hits ?? []

    // relevance rule, per collection: lexical hits are the signal — when the
    // query matched lexically, weak vector-only neighbors are dropped as noise.
    // Semantic hits are only a fallback for zero lexical matches, and only
    // within the vector threshold (tune via NUXT_SEARCH_VECTOR_THRESHOLD).
    const threshold = Number(useRuntimeConfig().searchVectorThreshold) || 0.4
    const keepHits = (hits: RawHit[]): RawHit[] => {
      const lexical = hits.filter(h => Number(h.text_match ?? 0) > 0)
      if (lexical.length) return lexical
      return threshold ? hits.filter(h => Number(h.vector_distance ?? 1) <= threshold) : []
    }

    const pages = keepHits(pageHits)
      .map(h => ({
        path: h.document?.path,
        title: h.document?.title,
        snippet: snippetOf(h) || String(h.document?.content ?? '').slice(0, 300)
      }))

    // One document can match through many chunks: keep the best per document.
    const bestByDoc = new Map<string, {
      id: string, pagePath: string, filename: string, snippet: string,
      matches: number, score: number
    }>()
    for (const hit of keepHits(chunkHits)) {
      const id = hit.document?.file_id ?? ''
      const score = hitScore(hit)
      const existing = bestByDoc.get(id)
      if (existing) {
        existing.matches++
        if (score > existing.score) {
          existing.snippet = snippetOf(hit)
          existing.score = score
        }
      } else {
        bestByDoc.set(id, {
          id,
          pagePath: hit.document?.page_path,
          filename: hit.document?.filename,
          snippet: snippetOf(hit),
          matches: 1,
          score
        })
      }
    }
    const chunks = [...bestByDoc.values()]
      .sort((a, b) => b.score - a.score)
      .map(({ score: _score, ...rest }) => rest)

    return { pages, chunks }
  } catch (error) {
    const e = error as { httpStatus?: number, message?: string }
    if (e?.httpStatus === 404 || String(e?.message ?? '').includes('404')) {
      return { pages: [], chunks: [] }
    }
    throw error
  }
})