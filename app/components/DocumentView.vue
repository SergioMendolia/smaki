<script setup lang="ts">
export interface DocumentChunk {
  index: number
  kind: 'text' | 'vision'
  page: number | null
  content: string
}

export interface DocumentData {
  id: string
  rel: string
  filename: string
  dir: string
  mime: string
  size: number
  status: 'indexed' | 'stale' | 'not-indexed'
  extracted: boolean
  vision: boolean | null
  globalVision: boolean
  indexedAt: string | null
  chunks: DocumentChunk[]
  isAdmin: boolean
}

const props = defineProps<{ doc: DocumentData }>()
const emit = defineEmits<{ refresh: [] }>()

const toast = useToast()

const isPdf = computed(() => props.doc.mime === 'application/pdf')
const isImage = computed(() => props.doc.mime.startsWith('image/'))
const canPreview = computed(
  () =>
    isImage.value ||
    ['application/pdf', 'text/plain', 'text/markdown', 'text/csv', 'application/json'].includes(props.doc.mime)
)
const previewUrl = computed(() => `/api/wiki/files/${props.doc.id}/download`)

const STATUS_META = {
  indexed: { label: 'Indexed', color: 'success' },
  stale: { label: 'Changed since indexing', color: 'warning' },
  'not-indexed': { label: 'Not indexed', color: 'neutral' }
} as const

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—'
}

const visionChunks = computed(() => props.doc.chunks.filter(c => c.kind === 'vision').length)

const visionOptions = computed(() => [
  { label: `Default (${props.doc.globalVision ? 'on' : 'off'})`, value: 'default' },
  { label: 'On', value: 'on' },
  { label: 'Off', value: 'off' }
])
const visionChoice = computed({
  get: () => (props.doc.vision === null ? 'default' : props.doc.vision ? 'on' : 'off'),
  set: async (value: string) => {
    const vision = value === 'default' ? null : value === 'on'
    try {
      await $fetch(`/api/admin/files/${props.doc.id}`, { method: 'PATCH', body: { vision } })
      toast.add({ title: 'Vision setting saved', description: 'Reindexing to apply it' })
      await reindex()
    } catch (error: any) {
      toast.add({ title: 'Could not set vision', description: error?.data?.statusMessage || error?.message, color: 'error' })
    }
  }
})

// --- reindex (admin): enqueue, then poll the queue until it drains ---
let pollTimer: ReturnType<typeof setInterval> | null = null

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})

async function reindex() {
  try {
    await $fetch('/api/admin/reindex', { method: 'POST', body: { rel: props.doc.rel } })
    toast.add({ title: `${props.doc.filename} queued for reindexing` })
    watchQueue()
  } catch (error: any) {
    toast.add({ title: 'Reindex failed', description: error?.data?.statusMessage || error?.message, color: 'error' })
  }
}

function watchQueue() {
  if (pollTimer) return
  pollTimer = setInterval(async () => {
    try {
      const queue = await $fetch<{ current: unknown, queued: unknown[] }>('/api/admin/index-queue')
      if (!queue.current && !queue.queued.length) {
        if (pollTimer) clearInterval(pollTimer)
        pollTimer = null
        toast.add({ title: 'Reindexing finished' })
        emit('refresh')
      }
    } catch {
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = null
    }
  }, 1500)
}

const crumbs = computed(() => {
  const segments = props.doc.dir ? props.doc.dir.split('/') : []
  const list = [{ name: 'Wiki', path: '' }]
  let current = ''
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment
    list.push({ name: segment, path: current })
  }
  return list
})

const enc = (p: string) => p.split('/').filter(Boolean).map(encodeURIComponent).join('/')

useHead(() => ({ title: `${props.doc.filename} — smaki` }))
</script>

<template>
  <article class="mx-auto max-w-3xl">
    <nav class="mb-4 flex flex-wrap items-center gap-1 text-xs text-muted">
      <template v-for="(crumb, i) in crumbs" :key="crumb.path + i">
        <span v-if="i > 0">/</span>
        <NuxtLink :to="`/wiki/${enc(crumb.path)}`" class="hover:text-primary">
          {{ crumb.name }}
        </NuxtLink>
      </template>
      <span>/</span>
      <span class="text-highlighted">{{ doc.filename }}</span>
    </nav>

    <div class="flex flex-wrap items-start gap-2">
      <h1 class="text-2xl font-bold break-all">{{ doc.filename }}</h1>
      <div class="ms-auto flex shrink-0 items-center gap-1">
        <UButton
          icon="i-lucide-download"
          color="neutral"
          variant="ghost"
          size="sm"
          label="Download"
          :to="previewUrl"
          :download="doc.filename"
        />
      </div>
    </div>

    <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
      <UBadge :color="STATUS_META[doc.status].color" variant="subtle" size="sm">
        {{ STATUS_META[doc.status].label }}
      </UBadge>
      <span>{{ humanSize(doc.size) }}</span>
      <span>· {{ doc.chunks.length }} chunk{{ doc.chunks.length === 1 ? '' : 's' }}</span>
      <span v-if="visionChunks">· {{ visionChunks }} by pdf vision</span>
      <span>· last indexed {{ formatDate(doc.indexedAt) }}</span>
    </div>

    <div class="mt-6">
      <div v-if="isImage" class="flex justify-center">
        <img :src="previewUrl" :alt="doc.filename" class="max-h-[80vh] object-contain" >
      </div>
      <iframe
        v-else-if="canPreview"
        :src="previewUrl"
        :title="doc.filename"
        class="h-[80vh] w-full rounded border border-default"
      />
      <UAlert
        v-else
        color="neutral"
        variant="subtle"
        title="No inline preview"
        description="This file type cannot be previewed — use the download button above."
        class="mt-6"
      />
    </div>

    <UCard v-if="doc.isAdmin" class="mt-6">
      <div class="flex flex-wrap items-center gap-3">
        <UButton icon="i-lucide-refresh-cw" size="sm" label="Reindex" @click="reindex" />
        <template v-if="isPdf">
          <span class="text-sm text-muted">PDF vision:</span>
          <USelect
            :model-value="visionChoice"
            :items="visionOptions"
            size="sm"
            class="w-44"
            @update:model-value="visionChoice = $event"
          />
        </template>
        <p v-if="doc.status === 'not-indexed'" class="w-full text-xs text-muted">
          This document has not been indexed yet — a reindex will make it searchable.
        </p>
      </div>
    </UCard>

    <UCard class="mt-6">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-list" class="h-5 w-5 text-muted" />
          <h2 class="font-semibold">Indexed chunks</h2>
          <span class="ms-auto text-xs text-muted">what search and the chat see</span>
        </div>
      </template>

      <p v-if="!doc.chunks.length" class="text-sm text-muted">
        Nothing indexed for this document yet.
      </p>
      <div v-else class="space-y-3">
        <div v-for="chunk in doc.chunks" :key="chunk.index">
          <p class="flex items-center gap-2 text-xs font-medium text-muted">
            Chunk {{ chunk.index }}
            <UBadge
              :color="chunk.kind === 'vision' ? 'primary' : 'neutral'"
              variant="subtle"
              size="sm"
            >
              {{ chunk.kind === 'vision' ? `vision · page ${chunk.page}` : 'text' }}
            </UBadge>
          </p>
          <pre class="mt-1 max-h-48 overflow-y-auto rounded bg-elevated p-3 text-xs whitespace-pre-wrap">{{ chunk.content }}</pre>
        </div>
      </div>
    </UCard>
  </article>
</template>