<script setup lang="ts">
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'

const props = defineProps<{
  page: {
    path: string
    markdown: string
    frontmatter: Record<string, unknown>
  }
}>()

const emit = defineEmits<{ (e: 'saved'): void }>()

const crepeRoot = ref<HTMLElement | null>(null)
const status = ref<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle')
const savedAt = ref('')
const errorMsg = ref('')

// frontmatter fields
const title = ref(String(props.page.frontmatter?.title ?? ''))
const description = ref(String(props.page.frontmatter?.description ?? ''))

const enc = (p: string) => p.split('/').filter(Boolean).map(encodeURIComponent).join('/')

let crepe: any = null
let ready = false
let savedPayload = ''
let timer: ReturnType<typeof setTimeout> | null = null

function currentPayload() {
  const frontmatter: Record<string, unknown> = { ...(props.page.frontmatter ?? {}) }
  if (title.value.trim()) frontmatter.title = title.value.trim()
  else delete frontmatter.title
  if (description.value.trim()) frontmatter.description = description.value.trim()
  else delete frontmatter.description
  delete frontmatter.tags
  return {
    markdown: crepe ? crepe.getMarkdown() : props.page.markdown,
    frontmatter
  }
}

const statusText = computed(() => {
  switch (status.value) {
    case 'dirty': return 'Unsaved changes…'
    case 'saving': return 'Saving…'
    case 'saved': return `Saved at ${savedAt.value}`
    case 'error': return `⚠️ ${errorMsg.value}`
    default: return ''
  }
})

async function save() {
  const payload = currentPayload()
  const serialized = JSON.stringify(payload)
  if (serialized === savedPayload) {
    status.value = 'idle'
    return
  }
  status.value = 'saving'
  try {
    await $fetch(`/api/wiki/page/${enc(props.page.path)}`, { method: 'PUT', body: payload })
    savedPayload = serialized
    savedAt.value = new Date().toLocaleTimeString()
    status.value = 'saved'
    emit('saved')
  } catch (e: any) {
    status.value = 'error'
    errorMsg.value = e?.data?.statusMessage || e?.message || 'Save failed'
  }
}

/** debounced auto-save, ~1.5s after the last change */
function scheduleSave() {
  if (!ready || !crepe) return
  if (JSON.stringify(currentPayload()) === savedPayload) return
  status.value = 'dirty'
  if (timer) clearTimeout(timer)
  timer = setTimeout(save, 1500)
}

watch([title, description], scheduleSave)

/** images pasted/dropped in the editor are embedded in the markdown as data URLs */
async function embedImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** Crepe AI provider: streams the rewrite from /api/ai/edit */
async function* aiProvider(context: { document: string, selection: string, instruction: string }, signal: AbortSignal) {
  const res = await fetch('/api/ai/edit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      document: context.document,
      selection: context.selection,
      instruction: context.instruction
    }),
    signal
  })
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.statusMessage || `AI request failed (${res.status})`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const text = decoder.decode(value, { stream: true })
    if (text) yield text
  }
}

/** open the AI instruction palette at the current selection (or cursor) */
async function openAiPalette() {
  if (!ready || !crepe) return
  const { editorViewCtx } = await import('@milkdown/kit/core')
  const { useAIInstructionTooltipAPI } = await import('@milkdown/crepe/feature/ai')
  crepe.editor.action((ctx: any) => {
    const { from, to } = ctx.get(editorViewCtx).state.selection
    useAIInstructionTooltipAPI(ctx).show(from, to)
  })
}

onMounted(async () => {
  const { Crepe } = await import('@milkdown/crepe')
  if (!crepeRoot.value) return
  crepe = new Crepe({
    root: crepeRoot.value,
    defaultValue: props.page.markdown,
    features: {
      [Crepe.Feature.AI]: true
    },
    featureConfigs: {
      [Crepe.Feature.Placeholder]: { text: 'Write something…', mode: 'block' },
      [Crepe.Feature.ImageBlock]: {
        onUpload: embedImage,
        inlineOnUpload: embedImage
      },
      [Crepe.Feature.AI]: {
        provider: aiProvider
      }
    }
  })
  crepe.on((listener: any) => {
    listener.markdownUpdated((_ctx: any, _markdown: string) => {
      if (!ready) return
      scheduleSave()
    })
  })
  try {
    await crepe.create()
  } catch (error) {
    errorMsg.value = `Editor failed to start: ${error instanceof Error ? error.message : error}`
    status.value = 'error'
    return
  }
  ready = true
  savedPayload = JSON.stringify(currentPayload())
})

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
  // flush pending auto-save so navigating away doesn't lose the last change
  if (status.value === 'dirty') save()
  crepe?.destroy()?.catch(() => {})
  crepe = null
})
</script>

<template>
  <div>
    <div class="flex items-start gap-2">
      <input
        v-model="title"
        type="text"
        placeholder="Title"
        class="min-w-0 flex-1 bg-transparent text-3xl font-bold text-highlighted outline-none placeholder:font-normal placeholder:text-muted"
      >
      <div class="ms-auto flex shrink-0 items-center gap-1">
        <UButton
          icon="i-lucide-sparkles"
          color="neutral"
          variant="ghost"
          size="sm"
          label="Ask AI"
          title="Rewrite or generate content with AI (select text first, or just place the cursor)"
          @click="openAiPalette"
        />
        <slot name="actions" />
      </div>
    </div>
    <input
      v-model="description"
      type="text"
      placeholder="Description"
      class="mt-1 w-full bg-transparent text-muted outline-none placeholder:opacity-60"
    >

    <div ref="crepeRoot" class="crepe-wrapper mt-6" />

    <p
      v-if="statusText"
      class="mt-2 text-sm text-muted"
      :class="{ 'text-error': status === 'error' }"
    >
      {{ statusText }}
    </p>
  </div>
</template>