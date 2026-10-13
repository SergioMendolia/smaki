import path from 'node:path'
import mammoth from 'mammoth'
import { extractText as unpdfExtract, getDocumentProxy } from 'unpdf'

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.html': 'text/html',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
}

export function mimeFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase()
  return MIME[ext] ?? 'application/octet-stream'
}

/**
 * Some PDF text layers emit one space per glyph: "N u m é r o".
 * When single characters dominate the token stream, collapse the
 * letter-letter and digit-digit gaps to recover real words.
 */
export function normalizeExtractedText(text: string): string {
  const tokens = text.split(/\s+/).filter(Boolean)
  if (tokens.length < 20) return text
  const singleRatio = tokens.filter(t => t.length === 1).length / tokens.length
  if (singleRatio < 0.35) return text
  // unicode-safe: collapse "N u m é r o" -> "Numéro", "2 4" -> "24"
  return text
    .replace(/(?<!\p{L})(\p{L}) (?=\p{L}(?!\p{L}))/gu, '$1')
    .replace(/(?<!\p{N})(\p{N}) (?=\p{N}(?!\p{N}))/gu, '$1')
}

/** extract plain text from binary documents for indexing */
export async function extractTextFromFile(buffer: Buffer, filename: string): Promise<string> {
  const ext = path.extname(filename).toLowerCase()
  try {
    if (ext === '.pdf') {
      const pdf = await getDocumentProxy(new Uint8Array(buffer))
      const { text } = await unpdfExtract(pdf, { mergePages: true })
      return normalizeExtractedText(Array.isArray(text) ? text.join('\n\n') : text)
    }
    if (ext === '.docx') {
      const result = await mammoth.extractRawText({ buffer })
      return normalizeExtractedText(result.value)
    }
    if (['.txt', '.md', '.csv', '.json', '.html'].includes(ext)) {
      return buffer.toString('utf8')
    }
  } catch (error) {
    console.error('[smaki] text extraction failed for', filename, error)
    return ''
  }
  return ''
}

/** split text into overlapping chunks suitable for embedding */
export function chunkText(text: string, size = 1200, overlap = 150): string[] {
  const clean = text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()
  if (!clean) return []
  if (clean.length <= size) return [clean]
  const paragraphs = clean.split(/\n\n+/)
  const chunks: string[] = []
  let current = ''
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length > size) {
      chunks.push(current)
      current = current.slice(-overlap) + '\n' + paragraph
    } else {
      current = current ? current + '\n\n' + paragraph : paragraph
    }
    while (current.length > size * 2) {
      chunks.push(current.slice(0, size))
      current = current.slice(size - overlap)
    }
  }
  if (current.trim()) chunks.push(current)
  return chunks
}