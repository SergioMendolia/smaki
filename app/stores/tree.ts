import { defineStore } from 'pinia'

export interface TreeDoc {
  id: string
  dir?: string
  filename: string
  mime: string
}

export interface TreeNode {
  name: string
  path: string
  isPage: boolean
  order: number
  children: TreeNode[]
  docs: TreeDoc[]
}

export const useTreeStore = defineStore('tree', () => {
  const nodes = ref<TreeNode | null>(null)
  const loaded = ref(false)

  async function fetchTree() {
    try {
      nodes.value = await $fetch<TreeNode>('/api/wiki/tree')
      loaded.value = true
    } catch {
      nodes.value = null
    }
  }

  return { nodes, loaded, fetchTree }
})