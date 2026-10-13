<script setup lang="ts">
const { current, close } = useFileViewer()

const previewUrl = computed(() => (current.value ? `/api/wiki/files/${current.value.id}/download` : ''))
const isImage = computed(() => (current.value?.mime ?? '').startsWith('image/'))
const canPreview = computed(
  () =>
    isImage.value ||
    ['application/pdf', 'text/plain', 'text/markdown', 'text/csv', 'application/json'].includes(
      current.value?.mime ?? ''
    )
)

function humanSize(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <UModal :open="!!current" :ui="{ content: 'max-w-5xl' }" @update:open="!$event && close()">
    <template #content>
      <div v-if="current" class="flex h-[80vh] flex-col">
        <div class="flex shrink-0 items-center gap-2 border-b border-default p-3">
          <UIcon
            :name="current.mime.startsWith('image/') ? 'i-lucide-image' : 'i-lucide-file'"
            class="h-4 w-4 shrink-0 text-muted"
          />
          <span class="truncate text-sm font-semibold">{{ current.filename }}</span>
          <UBadge v-if="current.size" color="neutral" variant="subtle" size="sm" class="shrink-0">
            {{ humanSize(current.size) }}
          </UBadge>
          <UButton
            class="ms-auto shrink-0"
            size="xs"
            variant="soft"
            icon="i-lucide-download"
            label="Download"
            :to="previewUrl"
            :download="current.filename"
          />
        </div>
        <div class="min-h-0 flex-1 overflow-auto bg-default">
          <img v-if="isImage" :src="previewUrl" :alt="current.filename" class="mx-auto max-h-full object-contain" />
          <iframe v-else-if="canPreview" :src="previewUrl" :title="current.filename" class="h-full w-full" />
          <div v-else class="flex h-full flex-col items-center justify-center gap-3 text-muted">
            <UIcon name="i-lucide-file-question" class="h-10 w-10" />
            <p class="text-sm">No inline preview for this file type.</p>
            <UButton icon="i-lucide-download" label="Download file" :to="previewUrl" :download="current.filename" />
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>