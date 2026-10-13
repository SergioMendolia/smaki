<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })

const props = defineProps<{ initialPath?: string }>()
const emit = defineEmits<{ (e: 'created', path: string): void }>()

const path = ref('')
const busy = ref(false)
const error = ref('')

watch(
  open,
  (isOpen) => {
    if (isOpen) {
      path.value = props.initialPath ?? ''
      error.value = ''
    }
  }
)

async function create() {
  busy.value = true
  error.value = ''
  try {
    const leaf = path.value.split('/').pop() || 'New page'
    const res = await $fetch<{ path: string }>('/api/wiki/page', {
      method: 'POST',
      body: { path: path.value, source: `---\ntitle: ${leaf}\n---\n\n` }
    })
    open.value = false
    emit('created', res.path)
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || 'Could not create the page'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UModal :open="open" @update:open="open = $event">
    <template #content>
      <div class="p-6">
        <h2 class="text-lg font-semibold">Create a page</h2>
        <p class="mt-1 text-sm text-muted">
          The path mirrors the folder structure, e.g. <code>recipes/desserts/flan</code>.
          It opens straight in the editor afterwards.
        </p>
        <form class="mt-4 flex gap-2" @submit.prevent="create">
          <UInput
            v-model="path"
            class="flex-1"
            placeholder="folder/page-name"
            autofocus
            required
          />
          <UButton type="submit" icon="i-lucide-plus" :loading="busy">Create</UButton>
        </form>
        <UAlert v-if="error" color="error" variant="subtle" :title="error" class="mt-3" />
      </div>
    </template>
  </UModal>
</template>