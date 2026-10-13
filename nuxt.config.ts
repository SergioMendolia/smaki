export default defineNuxtConfig({
  compatibilityDate: '2026-10-12',
  devtools: { enabled: true },
  modules: ['@nuxt/ui', '@pinia/nuxt'],
  vite: {
    server: {
      allowedHosts: ['localhost', '.docker.test']
    }
  },
  css: ['~/assets/css/main.css'],
  routeRules: {
    '/': { redirect: '/wiki' }
  },
  runtimeConfig: {
    // filesystem
    contentDir: 'content',
    dataDir: 'data',
    // typesense (env: NUXT_TYPESENSE_URL / NUXT_TYPESENSE_API_KEY)
    typesenseUrl: 'http://localhost:8108',
    typesenseApiKey: '',
    // LLM for RAG answers, any OpenAI-compatible endpoint (env: NUXT_LLM_URL / NUXT_LLM_MODEL / NUXT_LLM_API_KEY)
    llmUrl: '',
    llmModel: '',
    llmApiKey: '',
    llmSystemPrompt: '',
    llmMaxBytes: 262144,
    // embeddings (env: NUXT_EMBEDDING_MODEL / NUXT_EMBEDDING_URL / NUXT_EMBEDDING_API_KEY)
    embeddingModel: 'ts/e5-small',
    embeddingUrl: '',
    embeddingApiKey: '',
    // search quality: max vector distance for semantic-only hits (fallback when
    // nothing matched lexically; 0.4 calibrated for bge-family multilingual models)
    searchVectorThreshold: 0.4,
    public: {
      siteName: 'smaki'
    }
  }
})
