import { describe, expect, it } from 'vitest'
import { chunkText, mimeFor, normalizeExtractedText } from '../server/utils/text'

describe('mimeFor', () => {
  it('maps known extensions', () => {
    expect(mimeFor('a.pdf')).toBe('application/pdf')
    expect(mimeFor('a.docx')).toContain('wordprocessingml')
    expect(mimeFor('a.PNG')).toBe('image/png')
    expect(mimeFor('a.JPG')).toBe('image/jpeg')
    expect(mimeFor('dir/file.md')).toBe('text/markdown')
  })

  it('falls back to octet-stream', () => {
    expect(mimeFor('archive.zip')).toBe('application/octet-stream')
    expect(mimeFor('noext')).toBe('application/octet-stream')
  })
})

describe('normalizeExtractedText', () => {
  it('collapses glyph-spaced PDF text', () => {
    const spaced = 'N u m é r o d o c u m e n t a b c d e f g h i j k l m n o p q r s t u v w'
    expect(normalizeExtractedText(spaced)).not.toContain('N u m')
  })

  it('leaves normal text untouched', () => {
    const normal = 'Le paella est un plat traditionnel valencien cuisiné avec du riz, du safran et des légumes du jardin.'
    expect(normalizeExtractedText(normal)).toBe(normal)
  })

  it('leaves short texts untouched', () => {
    expect(normalizeExtractedText('N u m é r o')).toBe('N u m é r o')
  })
})

describe('chunkText', () => {
  it('returns [] for empty/whitespace text', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText('  \n\n  ')).toEqual([])
  })

  it('keeps small text as a single chunk', () => {
    expect(chunkText('hello world')).toEqual(['hello world'])
  })

  it('splits long text into multiple chunks with overlap', () => {
    const text = Array.from({ length: 50 }, (_, i) => `Paragraph ${i} ${'lorem ipsum '.repeat(10)}`).join('\n\n')
    const chunks = chunkText(text, 1200, 150)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeGreaterThan(0)
    // tail of the source must be covered by the last chunk
    const tail = text.slice(-60).trim()
    expect(chunks.at(-1)!.replace(/\s+/g, ' ')).toContain(tail.replace(/\s+/g, ' '))
  })

  it('handles a single huge paragraph with no separators', () => {
    const text = 'x'.repeat(5000)
    const chunks = chunkText(text, 1200, 150)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toContain('x'.repeat(1000))
  })

  it('normalizes line endings and excessive blank lines', () => {
    const chunks = chunkText('a\r\n\r\n\r\n\r\nb')
    expect(chunks).toEqual(['a\n\nb'])
  })
})