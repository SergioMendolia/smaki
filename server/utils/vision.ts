import { llmChat, type LlmContentPart } from './llm'

/** rendering resolution for VLM input (A4 @ 1.5 ≈ 890×1260 px) */
const RENDER_SCALE = 1.5
/** description length cap per page, generous enough for dense pages */
const MAX_DESCRIPTION_TOKENS = 2000

const PAGE_PROMPT =
  'Describe this document page for a search index. Transcribe all visible text, ' +
  'and describe in detail any tables (with their content), charts, diagrams, photos ' +
  'and other visual elements. Mention the overall layout if it carries meaning. ' +
  'Reply with the description ONLY — no preamble, no markdown fences.'

export function pdfVisionEnabled(): boolean {
  const config = useRuntimeConfig()
  return Boolean(config.pdfVision && config.vlmUrl && config.vlmModel)
}

export interface PdfPageDescription {
  page: number
  description: string
}

let globalsPatched = false

/** pdfjs needs browser globals that only exist in DOM contexts; @napi-rs/canvas provides them */
async function patchCanvasGlobals(): Promise<void> {
  if (globalsPatched) return
  const canvas = await import('@napi-rs/canvas')
  const g = globalThis as Record<string, unknown>
  g.Path2D ??= canvas.Path2D
  g.DOMMatrix ??= canvas.DOMMatrix
  g.ImageData ??= canvas.ImageData
  globalsPatched = true
}

/**
 * Run `fn` with `globalThis.pdfjsWorker` hidden: unpdf plants its bundled
 * (older) worker there, which pdfjs-dist would pick up as fake worker and
 * refuse on version mismatch. Only the first pdfjs-dist call consults it,
 * but hiding for every call is harmless and order-independent.
 */
async function withOwnWorker<T>(fn: () => Promise<T>): Promise<T> {
  const g = globalThis as { pdfjsWorker?: unknown }
  const saved = g.pdfjsWorker
  delete g.pdfjsWorker
  try {
    return await fn()
  } finally {
    if (saved !== undefined) g.pdfjsWorker = saved
  }
}

/** render one page of an already-open document */
async function renderPageToPng(
  doc: import('pdfjs-dist').PDFDocumentProxy,
  pageNumber: number
): Promise<Buffer> {
  await patchCanvasGlobals()
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale: RENDER_SCALE })
  const { createCanvas } = await import('@napi-rs/canvas')
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  // pdfjs types expect the DOM canvas; @napi-rs/canvas is structurally compatible
  const renderParams = {
    canvas,
    canvasContext: canvas.getContext('2d'),
    viewport
  } as unknown as Parameters<typeof page.render>[0]
  await page.render(renderParams).promise
  return canvas.toBuffer('image/png')
}

/** standard fonts + CJK char maps of the local pdfjs-dist, like unpdf's defaults */
function fontResources(): Record<string, string | boolean> {
  try {
    const base = import.meta.resolve('pdfjs-dist/package.json')
    return {
      standardFontDataUrl: new URL('./standard_fonts/', base).href,
      cMapUrl: new URL('./cmaps/', base).href,
      cMapPacked: true
    }
  } catch {
    return {}
  }
}

/** describe the first `maxPages` pages of a PDF, one VLM call each */
export async function describePdf(
  buffer: Buffer,
  maxPages: number,
  onProgress?: (page: number, total: number) => void
): Promise<PdfPageDescription[]> {
  const config = useRuntimeConfig()
  const descriptions: PdfPageDescription[] = []
  await withOwnWorker(async () => {
    // plain copy: a Buffer-backed Uint8Array cannot be transferred to the worker
    const data = new Uint8Array(buffer.byteLength)
    data.set(buffer)
    const { getDocument } = await import('pdfjs-dist')
    const doc = await getDocument({ data, disableFontFace: true, ...fontResources() }).promise
    try {
      const total = Math.min(doc.numPages, maxPages)
      for (let page = 1; page <= total; page++) {
        onProgress?.(page, total)
        const png = await renderPageToPng(doc, page)
        const parts: LlmContentPart[] = [
          { type: 'text', text: PAGE_PROMPT },
          {
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${png.toString('base64')}` }
          }
        ]
        const description = await llmChat(
          [{ role: 'user', content: parts }],
          {
            maxTokens: MAX_DESCRIPTION_TOKENS,
            endpoint: { url: config.vlmUrl, model: config.vlmModel, apiKey: config.vlmApiKey }
          }
        )
        if (description.trim()) descriptions.push({ page, description: description.trim() })
      }
    } finally {
      await doc.loadingTask.destroy()
    }
  })
  return descriptions
}