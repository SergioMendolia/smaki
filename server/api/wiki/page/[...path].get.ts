import { getPageDetail, prettyName, renderMarkdown, sortTree } from '../../../utils/content'
import { tables, useDb } from '../../../utils/db'
import { requireUser } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  requireUser(event)
  const rawPath = getRouterParam(event, 'path') ?? ''
  const { page, pagePath, children, dirs } = await getPageDetail(rawPath)

  if (!page) {
    // folder page: title + the documents directly in this folder + its subfolders
    const prefix = pagePath ? pagePath + '/' : ''
    const rows = useDb()
      .select({ id: tables.files.id, dir: tables.files.dir, filename: tables.files.filename, mime: tables.files.mime })
      .from(tables.files)
      .all()
    const docs: { id: string, dir?: string, filename: string, mime: string }[] = []
    for (const row of rows) {
      if (row.dir === pagePath) {
        docs.push({ id: row.id, dir: row.dir!, filename: row.filename!, mime: row.mime! })
      } else if (row.dir.startsWith(prefix)) {
        // a subfolder that exists only through its files (e.g. recipes/attachments):
        // make sure it appears in the listing
        const seg = row.dir.slice(prefix.length)!.split('/')[0]!
        const groupPath = prefix + seg
        if (!children.some(c => c.path === groupPath)) {
          children.push({ name: prettyName(seg), path: groupPath, isPage: false, order: 0, children: [], docs: [] })
        }
      }
    }
    // physical subfolders, including empty ones
    for (const dir of dirs) {
      if (!dir.startsWith(prefix)) continue
      const seg = dir.slice(prefix.length)!.split('/')[0]!
      const groupPath = prefix + seg
      if (!children.some(c => c.path === groupPath)) {
        children.push({ name: prettyName(seg), path: groupPath, isPage: false, order: 0, children: [], docs: [] })
      }
    }
    sortTree({ name: '', path: pagePath, isPage: false, order: 0, children, docs: [] })
    const isDir = dirs.includes(pagePath)
    if (children.length === 0 && docs.length === 0 && !isDir) {
      throw createError({ statusCode: 404, statusMessage: 'Page not found' })
    }
    const title = pagePath ? prettyName(pagePath.split('/')!.pop()!) : 'Wiki'
    return { path: pagePath, isPage: false, title, children, docs }
  }

  return {
    path: pagePath,
    isPage: true,
    title: page.title,
    description: page.description,
    frontmatter: page.frontmatter,
    markdown: page.markdown,
    raw: page.raw,
    html: renderMarkdown(page.markdown),
    file: page.file,
    children
  }
})