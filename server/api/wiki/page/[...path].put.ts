import { promises as fsp } from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { contentRoot, getPageDetail, safeJoin } from '../../../utils/content'
import { syncAll } from '../../../utils/indexer'
import { requireUser } from '../../../utils/auth'

/**
 * Save an existing page.
 * Accepts either:
 *  - { source }: raw markdown incl. frontmatter, written verbatim
 *  - { markdown, frontmatter? }: body + frontmatter keys, merged with the
 *    existing frontmatter (unknown keys preserved) and re-serialized.
 */
export default defineEventHandler(async (event) => {
  requireUser(event)
  const rawPath = getRouterParam(event, 'path') ?? ''
  const body = await readBody<{
    source?: string
    markdown?: string
    frontmatter?: Record<string, unknown>
  }>(event)

  const { page } = await getPageDetail(rawPath)
  if (!page) {
    throw createError({ statusCode: 404, statusMessage: 'Page not found' })
  }

  let source: string
  if (typeof body.source === 'string') {
    source = body.source
  } else if (typeof body.markdown === 'string') {
    const frontmatter = Object.fromEntries(
      Object.entries({ ...(page.frontmatter ?? {}), ...(body.frontmatter ?? {}) })
        .filter(([, value]) => value !== '' && value !== null && value !== undefined),
    )
    source = matter.stringify(body.markdown, frontmatter)
  } else {
    throw createError({ statusCode: 400, statusMessage: 'Either source or markdown is required' })
  }

  if (!source.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Page source cannot be empty' })
  }

  const abs = safeJoin(contentRoot(), page.file)
  await fsp.mkdir(path.dirname(abs), { recursive: true })
  await fsp.writeFile(abs, source, 'utf8')
  await syncAll()
  return { ok: true, path: page.path }
})