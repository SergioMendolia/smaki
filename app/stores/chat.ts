import { defineStore } from 'pinia'

export interface ChatSource {
  type: 'page' | 'chunk'
  path: string
  title?: string
  filename?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  sources?: ChatSource[]
}

export const useChatStore = defineStore('chat', () => {
  const open = ref(false)
  const busy = ref(false)
  const messages = ref<ChatMessage[]>([])
  const conversationId = ref<string | null>(null)
  // folder scope: retrieval restricted to this folder ('' = whole wiki)
  const scope = ref('')
  const scopeLabel = ref('')

  async function ask(question: string) {
    const text = question.trim()
    if (!text || busy.value) return
    busy.value = true
    messages.value.push({ role: 'user', text })
    try {
      const res = await $fetch<{ answer: string, conversation_id: string, sources: ChatSource[] }>(
        '/api/chat',
        {
          method: 'POST',
          body: { q: text, conversation_id: conversationId.value, scope: scope.value }
        }
      )
      conversationId.value = res.conversation_id || null
      messages.value.push({ role: 'assistant', text: res.answer, sources: res.sources })
    } catch (error: any) {
      messages.value.push({
        role: 'assistant',
        text: `⚠️ ${error?.data?.statusMessage || error?.message || 'Chat request failed'}`
      })
    } finally {
      busy.value = false
    }
  }

  function reset() {
    messages.value = []
    conversationId.value = null
  }

  function setScope(path: string, label: string) {
    if (scope.value !== path) {
      reset()
      scope.value = path
      scopeLabel.value = label
    }
  }

  /** header button: whole-wiki chat (fresh conversation) */
  function openGlobal() {
    if (open.value) {
      open.value = false
      return
    }
    setScope('', '')
    reset()
    open.value = true
  }

  /** folder page: chat restricted to that folder */
  function openFolder(path: string, label: string) {
    setScope(path, label)
    reset()
    open.value = true
  }

  function toggleDrawer(v?: boolean) {
    open.value = v ?? !open.value
  }

  return { open, busy, messages, conversationId, scope, scopeLabel, ask, reset, setScope, openGlobal, openFolder, toggleDrawer }
})