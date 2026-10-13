<script setup lang="ts">
import { useTreeStore, type TreeNode } from '~/stores/tree'

const tree = useTreeStore()
const mover = useMove()
const toast = useToast()

const enc = (p: string) => p.split('/').filter(Boolean).map(encodeURIComponent).join('/')

// sentinel for the content root (SelectItem cannot have an empty-string value)
const ROOT = '/'
const toDir = (v: string) => (v === ROOT ? '' : v)

const target = ref('')
const moving = ref(false)

const folders = computed(() => {
  const t = mover.current.value
  const excluded = (p: string): boolean => {
    if (!t) return false
    if (t.kind === 'folder') return p === t.path || (t.path ? p.startsWith(`${t.path}/`) : false)
    return p === t.path
  }
  const out: { label: string, value: string }[] = []
  const walk = (node: TreeNode) => {
    if (!node.isPage && !excluded(node.path)) out.push({ label: node.path || '(root)', value: node.path || ROOT })
    for (const child of node.children ?? []) walk(child)
  }
  if (tree.nodes) walk(tree.nodes)
  return out
})

const currentDir = computed(() => mover.current.value?.dir || ROOT)

watch(
  () => mover.current.value,
  (t) => { target.value = t?.dir || ROOT }
)

const kindLabel = computed(() => {
  switch (mover.current.value?.kind) {
    case 'page': return 'page'
    case 'folder': return 'folder'
    default: return 'file'
  }
})

async function move() {
  const t = mover.current.value
  if (!t) return
  moving.value = true
  try {
    if (t.kind === 'file') {
      await $fetch(`/api/wiki/files/${t.id}`, { method: 'PATCH', body: { dir: toDir(target.value) } })
      toast.add({ title: `Moved “${t.name}”` })
      mover.close()
      tree.fetchTree()
      await refreshNuxtData()
    } else {
      const res = await $fetch<{ path: string }>(`/api/wiki/page/${enc(t.path ?? '')}`, {
        method: 'PATCH',
        body: { to: toDir(target.value) }
      })
      toast.add({ title: `Moved “${t.name}”` })
      mover.close()
      tree.fetchTree()
      await navigateTo(`/wiki/${enc(res.path)}`)
    }
  } catch (error: any) {
    toast.add({ title: 'Move failed', description: error?.data?.statusMessage || error?.message, color: 'error' })
  } finally {
    moving.value = false
  }
}
</script>

<template>
  <UModal :open="!!mover.current.value" @update:open="!$event && mover.close()">
    <template #content>
      <div v-if="mover.current.value" class="p-4">
        <p class="text-sm font-semibold text-highlighted">Move {{ kindLabel }} “{{ mover.current.value.name }}”</p>
        <USelect
          v-model="target"
          :items="folders"
          :ui="{ content: 'min-w-80' }"
          class="mt-3 w-full"
          icon="i-lucide-folder"
        />
        <div class="mt-4 flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="mover.close()" />
          <UButton
            icon="i-lucide-folder-symlink"
            label="Move"
            :loading="moving"
            :disabled="target === currentDir"
            @click="move"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>