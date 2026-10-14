<script setup lang="ts">
import { useAuthStore } from '~/stores/auth'

interface AdminUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'member'
  createdAt: string
  lastAdmin: boolean
}

definePageMeta({
  middleware: [
    function () {
      const auth = useAuthStore()
      if (auth.checked && auth.user?.role !== 'admin') return navigateTo('/wiki')
    }
  ]
})

const auth = useAuthStore()
if (auth.checked && auth.user?.role !== 'admin') await navigateTo('/wiki')

const toast = useToast()
const users = ref<AdminUser[]>([])

async function load() {
  users.value = await $fetch<AdminUser[]>('/api/admin/users')
}
await load()

const me = computed(() => auth.user)

// --- user form (create + edit) ---
const formOpen = ref(false)
const editing = ref<AdminUser | null>(null)
const form = reactive({ email: '', name: '', password: '', role: 'member' as 'admin' | 'member' })
const formBusy = ref(false)

function openCreate() {
  editing.value = null
  Object.assign(form, { email: '', name: '', password: '', role: 'member' })
  formOpen.value = true
}

function openEdit(user: AdminUser) {
  editing.value = user
  Object.assign(form, { email: user.email, name: user.name, password: '', role: user.role })
  formOpen.value = true
}

async function submitForm() {
  formBusy.value = true
  try {
    if (editing.value) {
      await $fetch(`/api/admin/users/${editing.value.id}`, {
        method: 'PUT',
        body: { name: form.name, role: form.role, ...(form.password ? { password: form.password } : {}) }
      })
      toast.add({ title: 'User updated' })
    } else {
      await $fetch('/api/admin/users', {
        method: 'POST',
        body: { ...form }
      })
      toast.add({ title: 'User created' })
    }
    formOpen.value = false
    await load()
  } catch (error: any) {
    toast.add({ title: 'Save failed', description: error?.data?.statusMessage || error?.message, color: 'error' })
  } finally {
    formBusy.value = false
  }
}

async function removeUser(user: AdminUser) {
  if (!confirm(`Delete “${user.name}” (${user.email})? Their account and sessions will be removed.`)) return
  try {
    await $fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' })
    toast.add({ title: 'User deleted' })
    await load()
  } catch (error: any) {
    toast.add({ title: 'Delete failed', description: error?.data?.statusMessage || error?.message, color: 'error' })
  }
}

// --- indexing ---
interface QueueJob {
  id: string
  type: 'file' | 'sync' | 'full'
  label: string
  status: 'queued' | 'running' | 'done' | 'error'
  progress?: string
  error?: string
  queuedAt: number
  startedAt?: number
  finishedAt?: number
}

interface QueueState {
  current: QueueJob | null
  queued: QueueJob[]
  recent: QueueJob[]
}

const queue = ref<QueueState>({ current: null, queued: [], recent: [] })
let pollTimer: ReturnType<typeof setInterval> | null = null

const queueBusy = computed(() => Boolean(queue.value.current || queue.value.queued.length))

async function loadQueue() {
  queue.value = await $fetch<QueueState>('/api/admin/index-queue')
}

async function pollQueue() {
  const wasBusy = queueBusy.value
  await loadQueue()
  // refresh the file table when the queue has drained
  if (wasBusy && !queueBusy.value) await loadIndexFiles()
}

onMounted(() => {
  pollTimer = setInterval(pollQueue, queueBusy.value ? 1000 : 5000)
})
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
watch(queueBusy, busy => {
  if (!pollTimer) return
  clearInterval(pollTimer)
  pollTimer = setInterval(pollQueue, busy ? 1000 : 5000)
})

async function enqueueReindex(body: Record<string, unknown>, successTitle: string) {
  try {
    await $fetch('/api/admin/reindex', { method: 'POST', body })
    toast.add({ title: successTitle })
    await loadQueue()
  } catch (error: any) {
    toast.add({ title: 'Reindex failed', description: error?.data?.statusMessage || error?.message, color: 'error' })
  }
}

function reindexFile(file: IndexedFileRow) {
  return enqueueReindex({ rel: file.dir ? `${file.dir}/${file.filename}` : file.filename }, `${file.filename} queued for reindexing`)
}

async function reindex(full = false) {
  if (full && !confirm('Full reindex: every page and document will be wiped from the search index and re-embedded. This can take a while. Continue?')) return
  await enqueueReindex(full ? { full: true } : {}, full ? 'Full reindex queued' : 'Re-index queued')
}

// --- indexed files overview ---
interface IndexedFileRow {
  id: string
  dir: string
  filename: string
  mime: string
  size: number
  status: 'indexed' | 'stale' | 'not-indexed' | 'missing'
  extracted: boolean
  chunks: number
  visionChunks: number
  vision: boolean | null
  indexedAt: string | null
}

interface IndexedFileDetail {
  file: { dir: string, filename: string, mime: string, size: number, extracted: boolean, vision: boolean | null, indexedAt: string }
  chunks: { index: number, kind: 'text' | 'vision', page: number | null, content: string }[]
}

const indexFiles = ref<IndexedFileRow[]>([])
const pageStats = ref({ total: 0, upToDate: 0 })
const globalVision = ref(false)
const chunksOpen = ref(false)
const chunksLoading = ref(false)
const chunksDetail = ref<IndexedFileDetail | null>(null)

// table filters
const fileSearch = ref('')
const statusFilter = ref<'all' | IndexedFileRow['status']>('all')
const filteredFiles = computed(() => {
  const needle = fileSearch.value.trim().toLowerCase()
  return indexFiles.value.filter(file => {
    if (statusFilter.value !== 'all' && file.status !== statusFilter.value) return false
    if (!needle) return true
    return (`${file.dir}/${file.filename}`).toLowerCase().includes(needle)
  })
})

const STATUS_META: Record<IndexedFileRow['status'], { label: string, color: 'success' | 'warning' | 'neutral' | 'error' }> = {
  indexed: { label: 'Indexed', color: 'success' },
  stale: { label: 'Changed since indexing', color: 'warning' },
  'not-indexed': { label: 'Not indexed', color: 'neutral' },
  missing: { label: 'Missing on disk', color: 'error' }
}

const STATUS_FILTER_ITEMS = [
  { label: 'All statuses', value: 'all' },
  { label: 'Indexed', value: 'indexed' },
  { label: 'Changed since indexing', value: 'stale' },
  { label: 'Not indexed', value: 'not-indexed' },
  { label: 'Missing on disk', value: 'missing' }
]

function visionBadge(file: IndexedFileRow): { label: string, color: 'primary' | 'neutral' | 'error' } {
  if (file.vision === true) return { label: 'on', color: 'primary' }
  if (file.vision === false) return { label: 'off', color: 'neutral' }
  return { label: `default (${globalVision.value ? 'on' : 'off'})`, color: globalVision.value ? 'primary' : 'neutral' }
}

async function loadIndexFiles() {
  const res = await $fetch<{
    pages: { total: number, upToDate: number }
    globalVision: boolean
    files: IndexedFileRow[]
  }>('/api/admin/files')
  pageStats.value = res.pages
  globalVision.value = res.globalVision
  indexFiles.value = res.files
}
await loadIndexFiles()
await loadQueue()

function formatSize(bytes: number): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

async function openChunks(file: IndexedFileRow) {
  chunksOpen.value = true
  chunksLoading.value = true
  try {
    chunksDetail.value = await $fetch<IndexedFileDetail>(`/api/admin/files/${file.id}`)
  } catch (error: any) {
    chunksOpen.value = false
    toast.add({ title: 'Could not load chunks', description: error?.data?.statusMessage || error?.message, color: 'error' })
  } finally {
    chunksLoading.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-8">
    <div>
      <h1 class="text-2xl font-bold">Administration</h1>
      <p class="mt-1 text-sm text-muted">Users and search index.</p>
    </div>

    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-users" class="h-5 w-5 text-muted" />
          <h2 class="font-semibold">Users</h2>
          <UButton class="ms-auto" size="xs" icon="i-lucide-user-plus" label="Add user" @click="openCreate" />
        </div>
      </template>

      <ul class="divide-y divide-default">
        <li v-for="user in users" :key="user.id" class="flex items-center gap-3 py-2.5">
          <div class="min-w-0 flex-1">
            <p class="flex items-center gap-2 text-sm font-medium">
              {{ user.name }}
              <UBadge :color="user.role === 'admin' ? 'primary' : 'neutral'" variant="subtle" size="sm">
                {{ user.role }}
              </UBadge>
              <span v-if="user.id === me?.id" class="text-xs text-muted">(you)</span>
            </p>
            <p class="truncate text-xs text-muted">{{ user.email }}</p>
          </div>
          <UButton
            size="xs"
            variant="ghost"
            icon="i-lucide-pencil"
            :aria-label="`Edit ${user.name}`"
            @click="openEdit(user)"
          />
          <UButton
            size="xs"
            variant="ghost"
            color="error"
            icon="i-lucide-trash-2"
            :aria-label="`Delete ${user.name}`"
            :disabled="user.id === me?.id || user.lastAdmin"
            @click="removeUser(user)"
          />
        </li>
      </ul>
    </UCard>

    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-database" class="h-5 w-5 text-muted" />
          <h2 class="font-semibold">Search index</h2>
        </div>
      </template>

      <div class="flex flex-wrap items-center gap-3">
        <UButton
          icon="i-lucide-refresh-cw"
          label="Re-index wiki"
          :disabled="queueBusy"
          @click="reindex(false)"
        />
        <UButton
          color="error"
          variant="soft"
          icon="i-lucide-flame"
          label="Full reindex"
          :disabled="queueBusy"
          @click="reindex(true)"
        />
        <p class="w-full text-xs text-muted">
          Re-index only processes changed files (fast). A full reindex wipes the search index and
          re-embeds every page and document from scratch. Jobs run in the background queue below.
        </p>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-list-ordered" class="h-5 w-5 text-muted" />
          <h2 class="font-semibold">Indexing queue</h2>
          <span v-if="queueBusy" class="ms-auto flex items-center gap-1 text-xs text-muted">
            <UIcon name="i-lucide-loader-circle" class="h-3.5 w-3.5 animate-spin" />
            working
          </span>
          <span v-else class="ms-auto text-xs text-muted">idle</span>
        </div>
      </template>

      <div v-if="!queueBusy && !queue.recent.length" class="text-sm text-muted">
        Nothing is being indexed right now.
      </div>

      <ul v-else class="space-y-2 text-sm">
        <li v-if="queue.current" class="flex items-center gap-2 rounded bg-primary/10 px-3 py-2">
          <UIcon name="i-lucide-loader-circle" class="h-4 w-4 shrink-0 animate-spin" />
          <span class="min-w-0 flex-1 truncate">
            <span class="font-medium">{{ queue.current.label }}</span>
            <span v-if="queue.current.progress" class="text-muted"> — {{ queue.current.progress }}</span>
          </span>
        </li>
        <li
          v-for="job in queue.queued"
          :key="job.id"
          class="flex items-center gap-2 px-3 py-1.5 text-muted"
        >
          <UIcon name="i-lucide-clock" class="h-4 w-4 shrink-0" />
          <span class="min-w-0 flex-1 truncate">{{ job.label }}</span>
          <UBadge color="neutral" variant="subtle" size="sm">queued</UBadge>
        </li>
        <li
          v-for="job in queue.recent"
          :key="job.id"
          class="flex items-center gap-2 px-3 py-1.5"
        >
          <UIcon
            :name="job.status === 'error' ? 'i-lucide-circle-alert' : 'i-lucide-circle-check'"
            class="h-4 w-4 shrink-0"
            :class="job.status === 'error' ? 'text-error' : 'text-success'"
          />
          <span class="min-w-0 flex-1 truncate">{{ job.label }}</span>
          <span class="text-xs text-muted">
            {{ job.status === 'error' ? job.error : formatDate(new Date(job.finishedAt ?? job.queuedAt).toISOString()) }}
          </span>
        </li>
      </ul>
    </UCard>

    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-file-search" class="h-5 w-5 text-muted" />
          <h2 class="font-semibold">Indexed documents</h2>
          <span class="ms-auto text-xs text-muted">
            {{ pageStats.upToDate }}/{{ pageStats.total }} pages up to date
          </span>
        </div>
      </template>

      <p v-if="!indexFiles.length" class="text-sm text-muted">
        No documents in the content tree yet — only markdown pages, which are indexed as pages.
      </p>

      <template v-else>
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <UInput
            v-model="fileSearch"
            icon="i-lucide-search"
            placeholder="Filter by name…"
            size="sm"
            class="w-56"
          />
          <USelect
            v-model="statusFilter"
            :items="STATUS_FILTER_ITEMS"
            size="sm"
            class="w-52"
          />
          <span class="ms-auto text-xs text-muted">
            {{ filteredFiles.length }}/{{ indexFiles.length }} documents
          </span>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-default text-left text-xs text-muted uppercase tracking-wide">
                <th class="py-2 pe-3 font-medium">File</th>
                <th class="py-2 pe-3 font-medium">Status</th>
                <th class="py-2 pe-3 font-medium">Chunks</th>
                <th class="py-2 pe-3 font-medium">PDF vision</th>
                <th class="py-2 pe-3 font-medium">Size</th>
                <th class="py-2 pe-3 font-medium">Last indexed</th>
                <th class="py-2" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="file in filteredFiles" :key="file.id" class="border-b border-default last:border-0">
                <td class="py-2 pe-3">
                  <p class="font-medium">{{ file.filename }}</p>
                  <p class="text-xs text-muted">{{ file.dir || '·' }}</p>
                </td>
                <td class="py-2 pe-3">
                  <UBadge :color="STATUS_META[file.status].color" variant="subtle" size="sm">
                    {{ STATUS_META[file.status].label }}
                  </UBadge>
                </td>
                <td class="py-2 pe-3">
                  {{ file.chunks }}
                  <span v-if="file.visionChunks" class="text-xs text-muted">({{ file.visionChunks }} vision)</span>
                </td>
                <td class="py-2 pe-3">
                  <UBadge
                    :color="visionBadge(file).color"
                    variant="subtle"
                    size="sm"
                    :class="{ 'opacity-50': file.mime !== 'application/pdf' && file.vision === null }"
                  >
                    {{ visionBadge(file).label }}
                  </UBadge>
                </td>
                <td class="py-2 pe-3 whitespace-nowrap">{{ formatSize(file.size) }}</td>
                <td class="py-2 pe-3 whitespace-nowrap text-xs">{{ formatDate(file.indexedAt) }}</td>
                <td class="py-2 text-right">
                  <span class="inline-flex gap-1">
                    <UButton
                      v-if="file.chunks"
                      size="xs"
                      variant="ghost"
                      icon="i-lucide-eye"
                      label="Chunks"
                      :aria-label="`View chunks of ${file.filename}`"
                      @click="openChunks(file)"
                    />
                    <UButton
                      v-if="file.status !== 'missing'"
                      size="xs"
                      variant="ghost"
                      icon="i-lucide-refresh-cw"
                      label="Reindex"
                      :aria-label="`Reindex ${file.filename}`"
                      @click="reindexFile(file)"
                    />
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </UCard>

    <UModal :open="chunksOpen" @update:open="chunksOpen = $event">
      <template #content>
        <div class="p-6">
          <div v-if="chunksLoading" class="flex justify-center py-8">
            <UIcon name="i-lucide-loader-circle" class="h-6 w-6 animate-spin text-muted" />
          </div>
          <template v-else-if="chunksDetail">
            <h2 class="text-lg font-semibold">
              {{ chunksDetail.file.filename }}
            </h2>
            <p class="mt-1 text-xs text-muted">
              {{ chunksDetail.chunks.length }} chunk{{ chunksDetail.chunks.length === 1 ? '' : 's' }} indexed
              · last indexed {{ formatDate(chunksDetail.file.indexedAt) }}
            </p>
            <div class="mt-4 max-h-[60vh] space-y-3 overflow-y-auto">
              <div v-for="chunk in chunksDetail.chunks" :key="chunk.index">
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
                <pre class="mt-1 max-h-60 overflow-y-auto rounded bg-elevated p-3 text-xs whitespace-pre-wrap">{{ chunk.content }}</pre>
              </div>
            </div>
          </template>
          <div class="mt-5 flex justify-end">
            <UButton variant="ghost" label="Close" @click="chunksOpen = false" />
          </div>
        </div>
      </template>
    </UModal>

    <UModal :open="formOpen" @update:open="formOpen = $event">
      <template #content>
        <form class="p-6" @submit.prevent="submitForm">
          <h2 class="text-lg font-semibold">{{ editing ? `Edit ${editing.name}` : 'Add user' }}</h2>
          <div class="mt-4 space-y-3">
            <UFormField v-if="!editing" label="Email" required>
              <UInput v-model="form.email" type="email" class="w-full" autofocus required />
            </UFormField>
            <UFormField label="Name" required>
              <UInput v-model="form.name" class="w-full" required />
            </UFormField>
            <UFormField :label="editing ? 'New password (leave empty to keep)' : 'Password'" :required="!editing">
              <UInput v-model="form.password" type="password" class="w-full" :required="!editing" minlength="8" />
            </UFormField>
            <UFormField label="Role">
              <USelect
                v-model="form.role"
                :items="[
                  { label: 'Member', value: 'member' },
                  { label: 'Admin', value: 'admin' }
                ]"
                class="w-full"
                :disabled="editing?.lastAdmin"
              />
            </UFormField>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <UButton type="button" variant="ghost" label="Cancel" @click="formOpen = false" />
            <UButton type="submit" icon="i-lucide-check" :loading="formBusy">
              {{ editing ? 'Save' : 'Create' }}
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>