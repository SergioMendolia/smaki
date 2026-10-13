<script setup lang="ts">
import { useTreeStore, type TreeNode } from '~/stores/tree'

const tree = useTreeStore()
const viewer = useFileViewer()
const mover = useMove()

const props = defineProps<{ node: TreeNode, depth: number }>()

const expanded = ref(props.depth < 1)
// a folder with only documents still expands — documents count as content
const hasContent = computed(() => (props.node?.children?.length ?? 0) + (props.node?.docs?.length ?? 0) > 0)
const to = computed(() => `/wiki/${props.node.path}`)
const parentPath = computed(() =>
  props.node.path.includes('/') ? props.node.path.slice(0, props.node.path.lastIndexOf('/')) : ''
)
</script>

<template>
  <div>
    <div
      class="group flex items-center gap-1 rounded px-1 py-0.5 hover:bg-elevated"
      :style="{ paddingLeft: depth * 12 + 6 + 'px' }"
    >
      <button
        v-if="hasContent"
        class="flex h-4 w-4 shrink-0 items-center justify-center text-muted"
        :aria-label="expanded ? 'Collapse' : 'Expand'"
        @click.stop="expanded = !expanded"
      >
        <UIcon :name="expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" />
      </button>
      <UIcon v-else :name="node.isPage ? 'i-lucide-file-text' : 'i-lucide-folder'" class="h-4 w-4 shrink-0 text-muted" />
      <NuxtLink :to="to" class="truncate text-sm hover:text-primary" active-class="font-semibold text-primary">
        {{ node.name }}
      </NuxtLink>
      <button
        v-if="node.path"
        type="button"
        class="ms-auto hidden shrink-0 text-muted hover:text-primary group-hover:block"
        aria-label="Move"
        @click.stop="mover.open({ kind: node.isPage ? 'page' : 'folder', path: node.path, name: node.name, dir: parentPath })"
      >
        <UIcon name="i-lucide-folder-symlink" class="h-3.5 w-3.5" />
      </button>
    </div>
    <div v-if="node.children?.length && expanded">
      <WikiTreeNode v-for="child in node.children" :key="child.path" :node="child" :depth="depth + 1" />
    </div>
    <template v-if="node.docs?.length && (node.isPage || !hasContent || expanded)">
      <div
        v-for="doc in node.docs"
        :key="doc.id"
        class="group flex w-full items-center gap-1 rounded px-1 py-0.5 hover:bg-elevated"
        :style="{ paddingLeft: (depth + 1) * 12 + 6 + 'px' }"
      >
        <UIcon
          :name="doc.mime.startsWith('image/') ? 'i-lucide-image' : 'i-lucide-file'"
          class="h-4 w-4 shrink-0 text-muted"
        />
        <button type="button" class="truncate text-sm hover:text-primary" @click="viewer.open(doc)">
          {{ doc.filename }}
        </button>
        <button
          type="button"
          class="ms-auto hidden shrink-0 text-muted hover:text-primary group-hover:block"
          aria-label="Move file"
          @click.stop="mover.open({ kind: 'file', id: doc.id, name: doc.filename, dir: doc.dir })"
        >
          <UIcon name="i-lucide-folder-symlink" class="h-3.5 w-3.5" />
        </button>
      </div>
    </template>
  </div>
</template>