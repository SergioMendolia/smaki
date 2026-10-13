import Typesense from 'typesense'
import type { Client } from 'typesense'

let _client: Client | null = null

export function useTypesense(): Client {
  if (_client) return _client
  const config = useRuntimeConfig()
  if (!config.typesenseApiKey) {
    throw createError({ statusCode: 500, statusMessage: 'NUXT_TYPESENSE_API_KEY is not configured' })
  }
  const url = new URL(config.typesenseUrl)
  _client = new Typesense.Client({
    nodes: [
      {
        host: url.hostname,
        port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
        protocol: url.protocol.slice(0, -1)
      }
    ],
    apiKey: config.typesenseApiKey,
    // generous timeout: RAG retrieval + bulk imports may take a while
    connectionTimeoutSeconds: 180,
    retryIntervalSeconds: 2
  }) as unknown as Client
  return _client
}