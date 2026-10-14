<script setup lang="ts">
import { useChatStore } from '~/stores/chat'
import { useTreeStore } from '~/stores/tree'
import PageEditor from '~/components/PageEditor.vue'
import CreatePageDialog from '~/components/CreatePageDialog.vue'
import DocumentView, { type DocumentData } from '~/components/DocumentView.vue'

interface ChildNode {
  name: string
  path: string
  isPage: boolean
  children: ChildNode[]
}

interface PageResponse {
  path: string
  isPage: boolean
  title?: string
  description?: string
  frontmatter?: Record<string, unknown>
  markdown?: string
  html?: string
  file?: string
  children?: ChildNode[]
  docs?: DocItem[]
}

interface DocItem {
  id: string
  dir?: string
  filename: string
  mime: string
}

const route = useRoute()
const tree = useTreeStore()
const chat = useChatStore()
const mover = useMove()
const toast = useToast()

const pagePath = computed(() => {
  const slug = route.params.slug
  const segments = Array.isArray(slug) ? slug : slug ? [slug] : []
  return segments.map(s => decodeURIComponent(String(s))).join('/')
})

const enc = (p: string) => p.split('/').filter(Boolean).map(encodeURIComponent).join('/')
// NB: for the root page ('') the URL has no trailing path segment,
// handled by the dedicated /api/wiki/page index route
const apiUrl = computed(() =>
  pagePath.value ? `/api/wiki/page/${enc(pagePath.value)}` : '/api/wiki/page'
)

// one payload for both kinds of content: if the slug points at a document
// (a non-.md file on disk), the document API answers; otherwise it's a page
const { data: payload, error, refresh: refreshContent } = await useAsyncData(
  async () => {
    if (pagePath.value) {
      const doc = await $fetch<DocumentData>(`/api/wiki/document/${enc(pagePath.value)}`).catch(() => null)
      if (doc) return { kind: 'doc' as const, doc }
    }
    const page = await $fetch<PageResponse>(apiUrl.value)
    return { kind: 'page' as const, page }
  },
  { watch: [pagePath] }
)

const document = computed(() => (payload.value?.kind === 'doc' ? payload.value.doc : null))
const page = computed(() => (payload.value?.kind === 'page' ? payload.value.page : null))

const createOpen = ref(false)
const folderOpen = ref(false)

const createInitialPath = computed(() => {
  // on a missing page: create exactly that path; on a folder: create inside it
  if (error.value) return pagePath.value
  if (page.value && !page.value.isPage) return page.value.path ? `${page.value.path}/` : ''
  const parent = pagePath.value.includes('/') ? pagePath.value.slice(0, pagePath.value.lastIndexOf('/')) : ''
  return parent ? `${parent}/` : ''
})

async function onCreate(path: string) {
  tree.fetchTree()
  await navigateTo(`/wiki/${enc(path)}`)
}

async function onFolderCreated(path: string) {
  tree.fetchTree()
  await navigateTo(`/wiki/${enc(path)}`)
}

const crumbs = computed(() => {
  const segments = pagePath.value ? pagePath.value.split('/') : []
  const list = [{ name: 'Wiki', path: '' }]
  let current = ''
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment
    list.push({ name: segment, path: current })
  }
  return list
})

const parentPath = computed(() =>
  pagePath.value.includes('/') ? pagePath.value.slice(0, pagePath.value.lastIndexOf('/')) : ''
)

async function onDelete() {
  if (!confirm(`Delete the page “${page.value?.title}”? The .md file will be removed.`)) return
  try {
    await $fetch(apiUrl.value, { method: 'DELETE' })
    toast.add({ title: 'Page deleted' })
    tree.fetchTree()
    navigateTo(`/wiki/${enc(parentPath.value)}`)
  } catch (e: any) {
    toast.add({ title: 'Delete failed', description: e?.data?.statusMessage, color: 'error' })
  }
}

useHead(() => ({
  title: document.value
    ? `${document.value.filename} — smaki`
    : page.value?.title
      ? `${page.value.title} — smaki`
      : 'smaki'
}))
</script>

<template>
  <DocumentView v-if="document" :doc="document" @refresh="refreshContent()" />

  <div v-else-if="error" class="mx-auto max-w-3xl">
    <!-- error / not found -->
    <UAlert
      color="warning"
      variant="subtle"
      title="Page not found"
      :description="`There is no page at /wiki/${pagePath}.`"
    />
    <UButton class="mt-4" icon="i-lucide-plus" label="Create this page" @click="createOpen = true" />
    <CreatePageDialog v-model:open="createOpen" :initial-path="createInitialPath" @created="onCreate" />
  </div>

  <article v-else-if="page" class="mx-auto max-w-3xl">
    <!-- breadcrumbs -->
    <nav class="mb-4 flex flex-wrap items-center gap-1 text-xs text-muted">
      <template v-for="(crumb, i) in crumbs" :key="crumb.path + i">
        <span v-if="i > 0">/</span>
        <NuxtLink v-if="i < crumbs.length - 1" :to="`/wiki/${enc(crumb.path)}`" class="hover:text-primary">
          {{ crumb.name }}
        </NuxtLink>
        <span v-else class="text-highlighted">{{ crumb.name }}</span>
      </template>
    </nav>

    <!-- inline editor (pages are always directly editable) -->
    <PageEditor
      v-if="page.isPage"
      :key="page.path"
      :page="{ path: page.path, markdown: page.markdown ?? '', frontmatter: page.frontmatter ?? {} }"
      @saved="tree.fetchTree()"
    >
      <template #actions>
        <UButton
          icon="i-lucide-folder-symlink"
          color="neutral"
          variant="ghost"
          size="sm"
          label="Move"
          @click="mover.open({ kind: 'page', path: page.path, name: page.title ?? page.path, dir: parentPath })"
        />
        <UButton
          icon="i-lucide-plus"
          color="neutral"
          variant="ghost"
          size="sm"
          label="New page"
          @click="createOpen = true"
        />
        <UButton
          icon="i-lucide-trash-2"
          color="error"
          variant="ghost"
          size="sm"
          aria-label="Delete page"
          @click="onDelete"
        />
      </template>
    </PageEditor>

    <!-- folder page (no index.md): summary of contents + scoped RAG -->
    <template v-else>
      <div class="flex items-start gap-2">
        <h1 class="text-3xl font-bold">{{ page.title }}</h1>
        <div class="ms-auto flex shrink-0 items-center gap-1">
          <UButton
            v-if="page.path"
            icon="i-lucide-folder-symlink"
            color="neutral"
            variant="ghost"
            size="sm"
            label="Move"
            @click="mover.open({ kind: 'folder', path: page.path, name: page.title ?? page.path, dir: parentPath })"
          />
          <UButton
            icon="i-lucide-plus"
            color="neutral"
            variant="ghost"
            size="sm"
            label="New page"
            @click="createOpen = true"
          />
          <UButton
            icon="i-lucide-folder-plus"
            color="neutral"
            variant="ghost"
            size="sm"
            label="New folder"
            @click="folderOpen = true"
          />
        </div>
      </div>

      <div class="mt-6">
        <UButton
          icon="i-lucide-sparkles"
          variant="soft"
          size="sm"
          label="Ask this folder"
          @click="chat.openFolder(page.path, page.title ?? 'Wiki')"
        />
        <p class="mt-6 text-sm text-muted">Pages, subfolders and documents in this folder:</p>
        <ul v-if="page.children?.length || page.docs?.length" class="mt-3 space-y-1">
          <li v-for="child in page.children" :key="child.path">
            <NuxtLink
              :to="`/wiki/${enc(child.path)}`"
              class="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-elevated"
            >
              <UIcon
                :name="child.isPage && !child.children?.length ? 'i-lucide-file-text' : 'i-lucide-folder'"
                class="h-4 w-4 text-muted"
              />
              {{ child.name }}
            </NuxtLink>
          </li>
          <li v-for="doc in page.docs" :key="doc.id">
            <div class="group flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-elevated">
              <UIcon
                :name="doc.mime.startsWith('image/') ? 'i-lucide-image' : 'i-lucide-file'"
                class="h-4 w-4 text-muted"
              />
              <NuxtLink
                :to="`/wiki/${doc.dir ? enc(doc.dir) + '/' : ''}${enc(doc.filename)}`"
                class="truncate hover:text-primary"
              >
                {{ doc.filename }}
              </NuxtLink>
              <button
                type="button"
                class="ms-auto hidden shrink-0 text-muted hover:text-primary group-hover:block"
                aria-label="Move file"
                @click="mover.open({ kind: 'file', id: doc.id, name: doc.filename, dir: doc.dir })"
              >
                <UIcon name="i-lucide-folder-symlink" class="h-4 w-4" />
              </button>
            </div>
          </li>
        </ul>
        <p v-else class="mt-3 text-sm text-muted">This folder is empty.</p>
      </div>
    </template>

    <CreatePageDialog v-model:open="createOpen" :initial-path="createInitialPath" @created="onCreate" />
    <NewFolderDialog v-model:open="folderOpen" :initial-path="createInitialPath" @created="onFolderCreated" />
  </article>
</template>