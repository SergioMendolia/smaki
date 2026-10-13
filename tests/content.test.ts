import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildTree,
  ensureDirNode,
  getPageDetail,
  prettyName,
  safeJoin,
  sanitizePagePath,
  sortTree,
  walkContent,
  type PageMeta,
} from '../server/utils/content'

describe('sanitizePagePath', () => {
  it('drops traversal segments', () => {
    expect(sanitizePagePath('../etc/passwd')).toBe('etc/passwd')
    expect(sanitizePagePath('a/../../b')).toBe('a/b')
  })

  it('drops segments with backslashes or null bytes', () => {
    expect(sanitizePagePath('a\\b')).toBe('')
    expect(sanitizePagePath('a/b\x00c')).toBe('a')
  })

  it('drops dot segments and trims whitespace', () => {
    expect(sanitizePagePath('a/./b')).toBe('a/b')
    expect(sanitizePagePath(' recipes / paella ')).toBe('recipes/paella')
  })

  it('keeps the root empty', () => {
    expect(sanitizePagePath('')).toBe('')
    expect(sanitizePagePath('/')).toBe('')
  })
})

describe('safeJoin', () => {
  const base = '/tmp/base'

  it('joins valid relative paths', () => {
    expect(safeJoin(base, 'recipes/paella.md')).toBe(path.resolve(base, 'recipes/paella.md'))
  })

  it('accepts the base itself', () => {
    expect(safeJoin(base, '')).toBe(path.resolve(base))
  })

  it('refuses traversal outside the base', () => {
    expect(() => safeJoin(base, '../outside')).toThrow()
  })

  it('refuses absolute paths outside the base', () => {
    expect(() => safeJoin(base, '/etc/passwd')).toThrow()
  })
})

describe('prettyName', () => {
  it('humanizes slugs', () => {
    expect(prettyName('my-page_name')).toBe('My Page Name')
    expect(prettyName('paella')).toBe('Paella')
  })
})

describe('buildTree / ensureDirNode / sortTree', () => {
  const page = (p: string, title: string, order = 0): PageMeta => ({
    path: p,
    file: `${p}.md`,
    title,
    order,
    frontmatter: {},
    markdown: '',
    raw: '',
  })

  it('nests pages into folders and sorts by order then name', () => {
    const tree = buildTree([
      page('recipes/paella', 'Paella', 1),
      page('recipes/soup', 'Soup', 0),
      page('genealogy/grandparents', 'Grandparents'),
      page('home', 'Home', 2),
    ])
    expect(tree.children.map(c => c.name)).toEqual(['Genealogy', 'Recipes', 'Home'])
    const recipes = tree.children[1]!
    expect(recipes.isPage).toBe(false)
    expect(recipes.children.map(c => c.name)).toEqual(['Soup', 'Paella'])
    expect(recipes.children.every(c => c.isPage)).toBe(true)
  })

  it('creates intermediate folders for deep pages', () => {
    const tree = buildTree([page('a/b/c', 'Deep')])
    expect(tree.children[0]!.path).toBe('a')
    expect(tree.children[0]!.children[0]!.path).toBe('a/b')
    expect(tree.children[0]!.children[0]!.children[0]!.name).toBe('Deep')
  })

  it('ensureDirNode finds and creates folder nodes', () => {
    const tree = buildTree([page('recipes/paella', 'Paella')])
    expect(ensureDirNode(tree, 'recipes').path).toBe('recipes')
    const created = ensureDirNode(tree, 'new/folder')
    expect(created.path).toBe('new/folder')
    expect(ensureDirNode(tree, 'new/folder')).toBe(created)
    expect(tree.children.find(c => c.path === 'new')).toBeTruthy()
  })

  it('sortTree orders children by order first, then name; docs by filename', () => {
    const tree = buildTree([page('z', 'Z', 0), page('a', 'A', 0), page('b', 'B', 5)])
    tree.docs = [{ id: '2', filename: 'b.txt', mime: 'text/plain' }, { id: '1', filename: 'a.txt', mime: 'text/plain' }]
    sortTree(tree)
    expect(tree.children.map(c => c.name)).toEqual(['A', 'Z', 'B'])
    expect(tree.docs.map(d => d.filename)).toEqual(['a.txt', 'b.txt'])
  })
})

describe('filesystem (walkContent / getPageDetail)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'smaki-test-'))
    ;(globalThis as Record<string, unknown>).useRuntimeConfig = () => ({ contentDir: dir, dataDir: dir })
    writeFileSync(path.join(dir, 'index.md'), '---\ntitle: Home\n---\nwelcome')
    mkdirSync(path.join(dir, 'recipes', 'plans'), { recursive: true })
    writeFileSync(path.join(dir, 'recipes', 'paella.md'), '---\ntitle: Paella\norder: 2\n---\nrice dish')
    writeFileSync(path.join(dir, 'recipes', 'soup.md'), 'soup content')
    writeFileSync(path.join(dir, 'recipes', 'notes.txt'), 'plain notes')
    writeFileSync(path.join(dir, 'recipes', '.hidden.md'), 'should be skipped')
    mkdirSync(path.join(dir, 'genealogy'))
    writeFileSync(path.join(dir, 'genealogy', 'grandparents.md'), '---\ntitle: Grandparents\n---\nfamily')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('walkContent lists pages, files and dirs, skipping dotfiles', async () => {
    const { pages, files, dirs } = await walkContent()
    expect(pages.map(p => p.path)).toEqual(['genealogy/grandparents', 'index', 'recipes/paella', 'recipes/soup'])
    expect(pages.map(p => p.title)).toEqual(['Grandparents', 'Home', 'Paella', 'Soup'])
    expect(pages.find(p => p.path === 'recipes/paella')!.order).toBe(2)
    expect(pages.find(p => p.path === 'recipes/paella')!.markdown).toBe('rice dish')
    expect(files.map(f => f.rel)).toEqual(['recipes/notes.txt'])
    expect(dirs).toContain('recipes/plans')
    expect(dirs).toContain('recipes')
    expect(dirs).toContain('genealogy')
  })

  it('parsePage falls back to pretty names when title is empty', async () => {
    writeFileSync(path.join(dir, 'recipes', 'extra.md'), 'no frontmatter')
    const { pages } = await walkContent()
    expect(pages.find(p => p.path === 'recipes/extra')!.title).toBe('Extra')
  })

  it('getPageDetail on a folder page groups nested children', async () => {
    writeFileSync(path.join(dir, 'recipes', 'plans', 'summer.md'), '---\ntitle: Summer\n---\nplan')
    const detail = await getPageDetail('recipes')
    expect(detail.page).toBeNull() // no recipes.md page, folder view only
    const names = detail.children.map(c => c.name)
    expect(names).toContain('Soup')
    expect(names).toContain('Plans')
    const plans = detail.children.find(c => c.name === 'Plans')!
    expect(plans.isPage).toBe(false)
    expect(plans.children.map(c => c.name)).toEqual(['Summer'])
  })

  it('getPageDetail on the root sees top-level pages and folder groups', async () => {
    const detail = await getPageDetail('')
    expect(detail.page).toBeNull() // root folder view
    const names = detail.children.map(c => c.name)
    expect(names).toContain('Home') // index.md lives at the root
    expect(names).toContain('Recipes')
    expect(names).toContain('Genealogy')
    expect(names).not.toContain('Paella')
  })

  it('getPageDetail returns null page for unknown paths', async () => {
    const detail = await getPageDetail('nope')
    expect(detail.page).toBeNull()
    expect(detail.children).toEqual([])
  })
})