<script setup lang="ts">
import { useSearchStore } from '~/stores/search'

const search = useSearchStore()
const inputRef = ref<{ input?: HTMLInputElement } | null>(null)

watch(
  () => search.open,
  async (open) => {
    if (open) {
      await nextTick()
      inputRef.value?.input?.focus()
    }
  }
)

function goTo(path: string) {
  if (!path && path !== '') return
  search.close()
  navigateTo(`/wiki/${path.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`)
}

onMounted(() => {
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      search.openPalette()
    }
  })
})
</script>

<template>
  <UModal :open="search.open" @update:open="search.openPalette($event)">
    <template #content>
      <div class="p-4">
        <UInput
          ref="inputRef"
          v-model="search.q"
          icon="i-lucide-search"
          placeholder="Search pages and documents…"
          size="xl"
          class="w-full"
          :loading="search.loading"
          @input="search.onInput"
        />

        <div v-if="search.pages.length || search.chunks.length" class="mt-3 max-h-[60vh] space-y-4 overflow-y-auto">
          <div v-if="search.pages.length">
            <div class="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">Pages</div>
            <button
              v-for="page in search.pages"
              :key="page.path"
              class="block w-full rounded px-2 py-1.5 text-left hover:bg-elevated"
              @click="goTo(page.path)"
            >
              <div class="flex items-center gap-2 text-sm font-medium">
                <UIcon name="i-lucide-file-text" class="h-4 w-4 shrink-0 text-muted" />
                <span class="truncate">{{ page.title }}</span>
                <span class="truncate text-xs text-muted">/wiki/{{ page.path }}</span>
              </div>
              <div v-if="page.snippet" class="mt-0.5 line-clamp-2 text-xs text-muted" v-html="page.snippet" />
            </button>
          </div>

          <div v-if="search.chunks.length">
            <div class="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">Documents</div>
            <button
              v-for="chunk in search.chunks"
              :key="chunk.id + chunk.filename"
              class="block w-full rounded px-2 py-1.5 text-left hover:bg-elevated"
              @click="goTo(chunk.pagePath ? `${chunk.pagePath}/${chunk.filename}` : chunk.filename)"
            >
              <div class="flex items-center gap-2 text-sm font-medium">
                <UIcon name="i-lucide-paperclip" class="h-4 w-4 shrink-0 text-muted" />
                <span class="truncate">{{ chunk.filename }}</span>
                <UBadge
                  v-if="(chunk.matches ?? 1) > 1"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                  class="shrink-0"
                >
                  {{ chunk.matches }} passages
                </UBadge>
                <span class="truncate text-xs text-muted">on /wiki/{{ chunk.pagePath }}</span>
              </div>
              <div v-if="chunk.snippet" class="mt-0.5 line-clamp-2 text-xs text-muted" v-html="chunk.snippet" />
            </button>
          </div>
        </div>

        <div
          v-else-if="search.q.trim() && !search.loading"
          class="py-8 text-center text-sm text-muted"
        >
          No results for “{{ search.q }}”
        </div>

        <div class="mt-3 flex items-center justify-between border-t border-default pt-2 text-xs text-muted">
          <span><UKbd value="↑" /> <UKbd value="↓" /> to navigate, <UKbd value="↵" /> to open</span>
          <span><UKbd value="esc" /> to close</span>
        </div>
      </div>
    </template>
  </UModal>
</template>