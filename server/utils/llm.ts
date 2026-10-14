export interface LlmImagePart {
  type: 'image_url'
  image_url: { url: string }
}

export interface LlmTextPart {
  type: 'text'
  text: string
}

export type LlmContentPart = LlmTextPart | LlmImagePart

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | LlmContentPart[]
}

/** alternative endpoint for a single call (e.g. the VLM) */
export interface LlmEndpoint {
  url: string
  model: string
  apiKey: string
}

const TIMEOUT_MS = 300_000

export function resolveLlmEndpoint(override?: Partial<LlmEndpoint>): LlmEndpoint {
  const config = useRuntimeConfig()
  if (override?.url) {
    return { url: override.url, model: override.model ?? '', apiKey: override.apiKey ?? '' }
  }
  return { url: config.llmUrl, model: config.llmModel, apiKey: config.llmApiKey }
}

function chatUrls(raw: string): string[] {
  const base = raw.replace(/\/+$/, '')
  const urls = [`${base}/chat/completions`]
  if (!/\/v\d+$/.test(base)) urls.push(`${base}/v1/chat/completions`)
  return urls
}

async function postChat(
  url: string,
  body: Record<string, unknown>,
  apiKey: string,
  signal?: AbortSignal
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (apiKey) headers.authorization = `Bearer ${apiKey}`
  let timer: NodeJS.Timeout | undefined
  let requestSignal = signal
  if (!requestSignal) {
    const controller = new AbortController()
    timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    requestSignal = controller.signal
  }
  try {
    return await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: requestSignal
    })
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Call the configured OpenAI-compatible chat endpoint. `NUXT_LLM_URL` may or
 * may not end with `/v1` — the `/v1` variant is tried as a fallback on 404.
 */
export async function llmChat(
  messages: LlmMessage[],
  opts: { maxTokens?: number, endpoint?: Partial<LlmEndpoint> } = {}
): Promise<string> {
  const { url, model, apiKey } = resolveLlmEndpoint(opts.endpoint)
  if (!url) {
    throw createError({ statusCode: 500, statusMessage: 'no LLM URL is configured' })
  }
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.2
  }
  if (opts.maxTokens) body.max_tokens = opts.maxTokens

  let lastError: Error | null = null
  for (const chatUrl of chatUrls(url)) {
    let res: Response
    try {
      res = await postChat(chatUrl, body, apiKey)
    } catch (error) {
      const e = error as Error
      lastError = new Error(
        e.name === 'AbortError'
          ? `LLM request timed out after ${TIMEOUT_MS / 1000}s: ${url}`
          : `LLM request failed (${e.message}): ${url}`
      )
      continue
    }
    if (res.status === 404) continue
    if (!res.ok) {
      throw createError({
        statusCode: 502,
        statusMessage: `LLM ${res.status} ${res.statusText}: ${(await res.text().catch(() => '')).slice(0, 300)}`
      })
    }
    const data: any = await res.json()
    const answer = data?.choices?.[0]?.message?.content
    if (typeof answer !== 'string' || !answer.trim()) {
      throw createError({ statusCode: 502, statusMessage: 'LLM returned an empty answer' })
    }
    return answer
  }
  throw createError({
    statusCode: 502,
    statusMessage: `LLM endpoint not reachable: ${lastError?.message ?? 'no valid chat/completions endpoint found'}`
  })
}

/**
 * Streaming variant of llmChat: yields answer text chunks as they arrive
 * (SSE `data:` lines, OpenAI-compatible `stream: true`). Honors `signal` for
 * cancellation by the caller.
 */
export async function* llmChatStream(
  messages: LlmMessage[],
  opts: { maxTokens?: number, signal?: AbortSignal } = {}
): AsyncGenerator<string> {
  const config = useRuntimeConfig()
  if (!config.llmUrl) {
    throw createError({ statusCode: 500, statusMessage: 'NUXT_LLM_URL is not configured' })
  }
  const body: Record<string, unknown> = {
    model: config.llmModel,
    messages,
    temperature: 0.2,
    stream: true
  }
  if (opts.maxTokens) body.max_tokens = opts.maxTokens

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  opts.signal?.addEventListener('abort', () => controller.abort(), { once: true })

  try {
    let lastError: Error | null = null
    for (const url of chatUrls(config.llmUrl)) {
      let res: Response
      try {
        res = await postChat(url, body, config.llmApiKey, controller.signal)
      } catch (error) {
        const e = error as Error
        lastError = new Error(
          e.name === 'AbortError'
            ? `LLM request aborted or timed out after ${TIMEOUT_MS / 1000}s: ${url}`
            : `LLM request failed (${e.message}): ${url}`
        )
        continue
      }
      if (res.status === 404) continue
      if (!res.ok || !res.body) {
        throw createError({
          statusCode: 502,
          statusMessage: `LLM ${res.status} ${res.statusText}: ${(await res.text().catch(() => '')).slice(0, 300)}`
        })
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) return
        buffer += decoder.decode(value, { stream: true })
        let newline: number
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') return
          try {
            const parsed = JSON.parse(data)
            const text = parsed?.choices?.[0]?.delta?.content
            if (typeof text === 'string' && text) yield text
          } catch {
            // skip malformed SSE lines
          }
        }
      }
    }
    throw createError({
      statusCode: 502,
      statusMessage: `LLM endpoint not reachable: ${lastError?.message ?? 'no valid chat/completions endpoint found'}`
    })
  } finally {
    clearTimeout(timer)
  }
}

export interface SanitizeOptions {
  /** strip [n] citation markers (chat answers) */
  stripCitations?: boolean
  /** strip a leading ```markdown fence and its closing ``` (some models fence their output) */
  stripFences?: boolean
}

/** characters held back between chunks — a marker split across chunks must not leak */
const HOLD_BACK = 4

/**
 * Clean up a streaming LLM output: citation markers and wrapping code fences
 * can be split across chunks, so keep a small tail buffer between iterations
 * and strip inside it before yielding.
 */
export async function* sanitizeLlmStream(
  source: AsyncIterable<string>,
  opts: SanitizeOptions = {}
): AsyncGenerator<string> {
  const strip = (text: string): string =>
    opts.stripCitations ? text.replace(/\s*\[\d{1,2}\]/g, '') : text

  let buffer = ''
  let lookingForFence = Boolean(opts.stripFences)
  let hadFence = false
  for await (const chunk of source) {
    buffer += chunk
    // a wrapping fence can only be at the very start of the stream; keep
    // looking until the content clearly doesn't start with one
    if (lookingForFence) {
      const before = buffer
      buffer = buffer.replace(/^\s*```[a-zA-Z]*[ \t]*\r?\n/, '')
      if (buffer !== before) hadFence = true
      if (!buffer.trimStart().startsWith('`')) lookingForFence = false
    }
    buffer = strip(buffer)
    const safe = buffer.slice(0, -HOLD_BACK)
    buffer = buffer.slice(safe.length)
    if (safe) yield safe
  }
  buffer = strip(buffer)
  // strip the closing fence of a wrapper we removed at the start
  if (hadFence) buffer = buffer.replace(/\s*```\s*$/, '')
  if (buffer) yield buffer
}