<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })

const props = defineProps<{ initialPath?: string }>()
const emit = defineEmits<{ (e: 'created', path: string): void }>()

const name = ref('')
const busy = ref(false)
const error = ref('')

watch(
  open,
  (isOpen) => {
    if (isOpen) {
      name.value = ''
      error.value = ''
    }
  }
)

async function create() {
  busy.value = true
  error.value = ''
  const full = props.initialPath ? `${props.initialPath.replace(/\/+$/, '')}/${name.value}` : name.value
  try {
    const res = await $fetch<{ path: string }>('/api/wiki/folder', { method: 'POST', body: { path: full } })
    open.value = false
    emit('created', res.path)
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || 'Could not create the folder'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UModal :open="open" @update:open="open = $event">
    <template #content>
      <div class="p-6">
        <h2 class="text-lg font-semibold">Create a folder</h2>
        <p v-if="initialPath" class="mt-1 text-sm text-muted">
          inside <code>{{ initialPath || '(root)' }}</code>
        </p>
        <form class="mt-4 flex gap-2" @submit.prevent="create">
          <UInput
            v-model="name"
            class="flex-1"
            placeholder="folder name"
            autofocus
            required
          />
          <UButton type="submit" icon="i-lucide-folder-plus" :loading="busy">Create</UButton>
        </form>
        <UAlert v-if="error" color="error" variant="subtle" :title="error" class="mt-3" />
      </div>
    </template>
  </UModal>
</template>