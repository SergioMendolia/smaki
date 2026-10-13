import { defineStore } from 'pinia'

export interface PageHit {
  path: string
  title?: string
  snippet?: string
}

export interface ChunkHit {
  id: string
  pagePath: string
  filename: string
  snippet?: string
  /** number of matching passages inside the same document (deduped) */
  matches?: number
}

export const useSearchStore = defineStore('search', () => {
  const open = ref(false)
  const q = ref('')
  const loading = ref(false)
  const pages = ref<PageHit[]>([])
  const chunks = ref<ChunkHit[]>([])
  let timer: ReturnType<typeof setTimeout> | null = null

  async function run() {
    const query = q.value.trim()
    if (!query) {
      pages.value = []
      chunks.value = []
      return
    }
    loading.value = true
    try {
      const res = await $fetch<{ pages: PageHit[], chunks: ChunkHit[] }>('/api/search', {
        query: { q: query }
      })
      pages.value = res.pages ?? []
      chunks.value = res.chunks ?? []
    } catch {
      // keep previous results on failure
    } finally {
      loading.value = false
    }
  }

  function onInput() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(run, 250)
  }

  function openPalette(v?: boolean) {
    open.value = v ?? !open.value
  }

  function close() {
    open.value = false
  }

  return { open, q, loading, pages, chunks, run, onInput, openPalette, close }
})