import { promises as fsp } from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({ html: true, linkify: true })

export interface PageMeta {
  /** '' for the root index.md, 'recipes', 'recipes/paella', ... */
  path: string
  /** relative to the content root, e.g. 'recipes/paella.md' */
  file: string
  title: string
  description?: string
  order: number
  /** parsed frontmatter data (may contain arbitrary keys) */
  frontmatter: Record<string, unknown>
  /** markdown body without frontmatter */
  markdown: string
  /** raw file content including frontmatter */
  raw: string
}

export interface ContentFile {
  /** relative path, e.g. 'recipes/scan.pdf' */
  rel: string
  dir: string
  filename: string
}

export interface TreeDoc {
  id: string
  dir?: string
  filename: string
  mime: string
}

export interface TreeNode {
  name: string
  path: string
  isPage: boolean
  order: number
  children: TreeNode[]
  /** files living in this folder (filled by the tree endpoint) */
  docs: TreeDoc[]
}

export function contentRoot(): string {
  const config = useRuntimeConfig()
  return path.resolve(config.contentDir)
}

/** join a relative path onto the content root, refusing traversal */
export function safeJoin(base: string, rel: string): string {
  const target = path.resolve(base, rel)
  const resolvedBase = path.resolve(base)
  if (target !== resolvedBase && !target.startsWith(resolvedBase + path.sep)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid path' })
  }
  return target
}

/** strip unsafe segments; '' stays '' (root page) */
export function sanitizePagePath(raw: string): string {
  return raw
    .split('/')
    .map(s => s.trim())
    .filter(s => s && s !== '.' && s !== '..' && !s.includes('\\') && !s.includes('\0'))
    .join('/')
}

export function prettyName(segment: string): string {
  return segment
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

async function parsePage(absFile: string, pagePath: string): Promise<PageMeta> {
  const raw = await fsp.readFile(absFile, 'utf8')
  const parsed = matter(raw)
  const fm = (parsed.data ?? {}) as Record<string, unknown>
  const fallback = pagePath === '' ? 'Home' : prettyName(pagePath.split('/')!.pop()!)
  const title = typeof fm.title === 'string' && fm.title.trim() ? fm.title : fallback
  return {
    path: pagePath,
    file: path.relative(contentRoot(), absFile),
    title,
    description: typeof fm.description === 'string' ? fm.description : undefined,
    order: Number(fm.order) || 0,
    frontmatter: fm,
    markdown: parsed.content,
    raw
  }
}

async function walkDir(
  absDir: string,
  relDir: string,
  pages: PageMeta[],
  files: ContentFile[],
  dirs: string[]
): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fsp.readdir(absDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name
    const abs = path.join(absDir, entry.name)
    if (entry.isDirectory()) {
      dirs.push(rel)
      await walkDir(abs, rel, pages, files, dirs)
    } else if (entry.isFile()) {
      // uniform treatment: every .md file is a page, every other file a document
      if (entry.name.endsWith('.md')) {
        pages.push(await parsePage(abs, rel.replace(/\.md$/, '')))
      } else {
        files.push({ rel, dir: relDir, filename: entry.name })
      }
    }
  }
}

/** walk the content tree: markdown pages, all other files (documents) and the directories */
export async function walkContent(): Promise<{ pages: PageMeta[], files: ContentFile[], dirs: string[] }> {
  const pages: PageMeta[] = []
  const files: ContentFile[] = []
  const dirs: string[] = []
  await walkDir(contentRoot(), '', pages, files, dirs)
  pages.sort((a, b) => a.path.localeCompare(b.path))
  return { pages, files, dirs }
}

export function renderMarkdown(source: string): string {
  return md.render(source)
}

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** plain text of a page, used for the typesense index */
export function pagePlainText(p: PageMeta): string {
  return htmlToText(md.render(p.markdown))
}

const byOrderName = (a: TreeNode, b: TreeNode) =>
  a.order - b.order || a.name.localeCompare(b.name)

/** build the navigation tree from the flat page list (folders are never pages) */
export function buildTree(pages: PageMeta[]): TreeNode {
  const root: TreeNode = { name: 'Wiki', path: '', isPage: false, order: 0, children: [], docs: [] }
  const dirNodes = new Map<string, TreeNode>([['', root]])
  const ensureDir = (dir: string): TreeNode => {
    if (dirNodes.has(dir)) return dirNodes.get(dir)!
    const parent = dir.includes('/') ? ensureDir(dir.slice(0, dir.lastIndexOf('/'))) : root
    const node: TreeNode = { name: prettyName(dir.split('/')!.pop()!), path: dir, isPage: false, order: 0, children: [], docs: [] }
    parent.children.push(node)
    dirNodes.set(dir, node)
    return node
  }
  // make sure every intermediate folder exists first
  for (const p of pages) {
    if (p.path.includes('/')) ensureDir(p.path.slice(0, p.path.lastIndexOf('/')))
  }
  for (const p of pages) {
    const parent = p.path.includes('/') ? ensureDir(p.path.slice(0, p.path.lastIndexOf('/'))) : root
    parent.children.push({ name: p.title, path: p.path, isPage: true, order: p.order, children: [], docs: [] })
  }
  const sortRec = (node: TreeNode) => {
    node.children.sort(byOrderName)
    for (const c of node.children) sortRec(c)
  }
  sortRec(root)
  return root
}

/** find (or create) the tree node for a folder path, mirroring the content dirs */
export function ensureDirNode(root: TreeNode, dir: string): TreeNode {
  if (!dir) return root
  let node = root
  let current = ''
  for (const seg of dir.split('/')) {
    current = current ? `${current}/${seg}` : seg
    let next = node.children.find(c => c.path === current)
    if (!next) {
      next = { name: prettyName(seg), path: current, isPage: false, order: 0, children: [], docs: [] }
      node.children.push(next)
    }
    node = next
  }
  return node
}

/** sort a tree by order/name and the docs of each node by filename */
export function sortTree(node: TreeNode) {
  node.children.sort(byOrderName)
  node.docs.sort((a, b) => a.filename.localeCompare(b.filename))
  for (const c of node.children) sortTree(c)
}

/** page detail: the page itself (if any) + immediate child nodes */
export async function getPageDetail(rawPath: string) {
  const pagePath = sanitizePagePath(rawPath)
  const { pages, dirs } = await walkContent()
  const page = pages.find(p => p.path === pagePath) ?? null
  const prefix = pagePath ? pagePath + '/' : ''
  const children: TreeNode[] = []
  for (const p of pages) {
    if (p.path === pagePath || !p.path.startsWith(prefix)) continue
    const rest = p.path.slice(prefix.length)
    const segments = rest.split('/')
    if (segments.length > 1) {
      // nested page: show its top folder
      const groupPath = prefix + segments[0]!
      let group = children.find(c => c.path === groupPath)
      if (!group) {
        group = { name: prettyName(segments[0]!), path: groupPath, isPage: false, order: 0, children: [], docs: [] }
        children.push(group)
      }
      group.children.push({ name: p.title, path: p.path, isPage: true, order: p.order, children: [], docs: [] })
    } else {
      children.push({ name: p.title, path: p.path, isPage: true, order: p.order, children: [], docs: [] })
    }
  }
  children.sort(byOrderName)
  return { page, pagePath, children, dirs }
}

