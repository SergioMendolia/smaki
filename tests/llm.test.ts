import { describe, expect, it } from 'vitest'
import { resolveLlmEndpoint, sanitizeLlmStream } from '../server/utils/llm'

async function* fromChunks(chunks: string[]): AsyncGenerator<string> {
  for (const chunk of chunks) yield chunk
}

async function collect(gen: AsyncGenerator<string>): Promise<string> {
  let out = ''
  for await (const chunk of gen) out += chunk
  return out
}

describe('resolveLlmEndpoint', () => {
  it('falls back to the conversational LLM config without an override', () => {
    const endpoint = resolveLlmEndpoint()
    expect(endpoint.url).toBeUndefined()
    expect(endpoint.model).toBeUndefined()
  })

  it('uses the override when a url is given, filling gaps', () => {
    const endpoint = resolveLlmEndpoint({
      url: 'https://ai.infomaniak.com/v1',
      model: 'mistralai/Ministral-3-14B-Instruct-2512',
      apiKey: 'secret'
    })
    expect(endpoint).toEqual({
      url: 'https://ai.infomaniak.com/v1',
      model: 'mistralai/Ministral-3-14B-Instruct-2512',
      apiKey: 'secret'
    })
  })

  it('keeps the override even without a model or key', () => {
    const endpoint = resolveLlmEndpoint({ url: 'https://example.com' })
    expect(endpoint).toEqual({ url: 'https://example.com', model: '', apiKey: '' })
  })
})

describe('sanitizeLlmStream', () => {
  it('strips citation markers within a chunk', async () => {
    const out = await collect(
      sanitizeLlmStream(fromChunks(['Hello [1] world [12].']), { stripCitations: true })
    )
    expect(out).toBe('Hello world.')
  })

  it('strips citation markers split across chunks', async () => {
    const out = await collect(
      sanitizeLlmStream(fromChunks(['Hello [', '1', '] world']), { stripCitations: true })
    )
    expect(out).toBe('Hello world')
  })

  it('keeps bracketed numbers when stripCitations is off', async () => {
    const out = await collect(sanitizeLlmStream(fromChunks(['See [1] and [2].'])))
    expect(out).toBe('See [1] and [2].')
  })

  it('strips a wrapping code fence', async () => {
    const out = await collect(
      sanitizeLlmStream(fromChunks(['```markdown\n', 'Some **bold** text.\n', '```']), {
        stripFences: true
      })
    )
    expect(out).toBe('Some **bold** text.')
  })

  it('leaves fenced code blocks in the content alone', async () => {
    const source = 'Example:\n\n```js\nconst a = 1\n```\n'
    const out = await collect(sanitizeLlmStream(fromChunks([source]), { stripFences: true }))
    expect(out).toBe(source)
  })

  it('passes plain text through unchanged', async () => {
    const out = await collect(sanitizeLlmStream(fromChunks(['Just ', 'text.'])))
    expect(out).toBe('Just text.')
  })
})