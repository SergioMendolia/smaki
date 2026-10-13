<script setup lang="ts">
import { useTreeStore } from '~/stores/tree'

const tree = useTreeStore()
</script>

<template>
  <div>
    <NuxtLink
      to="/wiki"
      class="mb-1 flex items-center gap-2 rounded px-1.5 py-1 text-sm font-semibold hover:bg-elevated hover:text-primary"
      active-class="text-primary"
    >
      <UIcon name="i-lucide-house" class="h-4 w-4" />
      Wiki
    </NuxtLink>
    <div v-if="tree.nodes" class="space-y-0.5">
      <WikiTreeNode
        v-for="child in tree.nodes.children"
        :key="child.path"
        :node="child"
        :depth="0"
      />
    </div>
    <div v-else class="px-1.5 text-sm text-muted">Loading…</div>
  </div>
</template>