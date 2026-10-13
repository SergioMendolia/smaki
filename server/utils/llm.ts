export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const TIMEOUT_MS = 300_000

function chatUrls(raw: string): string[] {
  const base = raw.replace(/\/+$/, '')
  const urls = [`${base}/chat/completions`]
  if (!/\/v\d+$/.test(base)) urls.push(`${base}/v1/chat/completions`)
  return urls
}

async function postChat(url: string, body: Record<string, unknown>): Promise<Response> {
  const config = useRuntimeConfig()
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (config.llmApiKey) headers.authorization = `Bearer ${config.llmApiKey}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Call the configured OpenAI-compatible chat endpoint. `NUXT_LLM_URL` may or
 * may not end with `/v1` — the `/v1` variant is tried as a fallback on 404.
 */
export async function llmChat(
  messages: LlmMessage[],
  opts: { maxTokens?: number } = {}
): Promise<string> {
  const config = useRuntimeConfig()
  if (!config.llmUrl) {
    throw createError({ statusCode: 500, statusMessage: 'NUXT_LLM_URL is not configured' })
  }
  const body: Record<string, unknown> = {
    model: config.llmModel,
    messages,
    temperature: 0.2
  }
  if (opts.maxTokens) body.max_tokens = opts.maxTokens

  let lastError: Error | null = null
  for (const url of chatUrls(config.llmUrl)) {
    let res: Response
    try {
      res = await postChat(url, body)
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