import { llmChatStream, sanitizeLlmStream, type LlmMessage } from '../../utils/llm'

const SYSTEM_PROMPT =
  'You are a writing assistant for a family wiki. The user selects text from a markdown page ' +
  '(or positions the cursor) and gives an instruction. Apply the instruction and return ONLY ' +
  'the resulting markdown — no explanation, no surrounding code fences. ' +
  'Keep the original language unless the instruction says otherwise. ' +
  'Preserve markdown formatting (headings, lists, links, images) and the meaning of the content.'

/** streaming AI edit for the page editor (Crepe AI feature) */
export default defineEventHandler(async (event) => {
  requireUser(event)
  const config = useRuntimeConfig()
  if (!config.llmModel) {
    throw createError({ statusCode: 503, statusMessage: 'AI editing is not configured: set NUXT_LLM_MODEL (and NUXT_LLM_URL)' })
  }
  const body = await readBody<{ document?: string, selection?: string, instruction?: string }>(event)
  const instruction = body.instruction?.trim() ?? ''
  if (!instruction) {
    throw createError({ statusCode: 400, statusMessage: 'An instruction is required' })
  }
  const document = typeof body.document === 'string' ? body.document.slice(0, 60000) : ''
  const selection = typeof body.selection === 'string' ? body.selection.slice(0, 20000) : ''

  const messages: LlmMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: selection
        ? `Full document (context):\n${document}\n\nText to rewrite:\n${selection}\n\nInstruction: ${instruction}`
        : `Full document (context):\n${document}\n\nThe user wants new content for this page (no text selected).\n\nInstruction: ${instruction}`
    }
  ]

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of sanitizeLlmStream(llmChatStream(messages), { stripFences: true })) {
          controller.enqueue(encoder.encode(chunk))
        }
      } catch (error: any) {
        // surface mid-stream failures to the editor as a trailing error note
        const e = error as { statusMessage?: string, message?: string }
        controller.enqueue(encoder.encode(`\n\n⚠️ AI edit failed: ${e?.statusMessage || e?.message || String(error)}`))
      }
      controller.close()
    }
  })
  return new Response(stream, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' }
  })
})