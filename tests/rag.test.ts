import { describe, expect, it } from 'vitest'
import { buildContext } from '../server/utils/rag'

const pageHit = (path: string, content: string) => ({ document: { path, title: path, content } })
const chunkHit = (fileId: string, filename: string, content: string) => ({
  document: { file_id: fileId, page_path: 'docs', filename, content }
})

describe('buildContext', () => {
  it('merges pages first, then chunks', () => {
    const entries = buildContext(
      [pageHit('wiki/a', 'page content')],
      [chunkHit('f1', 'doc.pdf', 'chunk content')],
      100000
    )
    expect(entries).toHaveLength(2)
    expect(entries[0].source).toMatchObject({ type: 'page', path: 'wiki/a' })
    expect(entries[1].source).toMatchObject({ type: 'chunk', filename: 'doc.pdf' })
  })

  it('keeps at most 2 chunks per file', () => {
    const entries = buildContext(
      [],
      [
        chunkHit('f1', 'a.pdf', 'one'),
        chunkHit('f1', 'a.pdf', 'two'),
        chunkHit('f1', 'a.pdf', 'three'),
        chunkHit('f2', 'b.pdf', 'four')
      ],
      100000
    )
    expect(entries).toHaveLength(3)
    expect(entries.map(e => e.text)).toEqual(['one', 'two', 'four'])
  })

  it('trims entries to the char budget', () => {
    const big = 'x'.repeat(600)
    const entries = buildContext(
      [pageHit('wiki/a', big), pageHit('wiki/b', big)],
      [],
      700
    )
    expect(entries).toHaveLength(1)
    expect(entries[0].text.length).toBe(600)
  })

  it('skips hits without a path or with empty content', () => {
    const entries = buildContext(
      [{ document: { title: 'no path' } }, pageHit('wiki/a', '   ')],
      [],
      100000
    )
    expect(entries).toHaveLength(0)
  })
})