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
  /** markdown-rendered answer (assistant messages) */
  html?: string
  sources?: ChatSource[]
}

export const useChatStore = defineStore('chat', () => {
  const open = ref(false)
  const busy = ref(false)
  const messages = ref<ChatMessage[]>([])
  // folder scope: retrieval restricted to this folder ('' = whole wiki)
  const scope = ref('')
  const scopeLabel = ref('')

  async function ask(question: string) {
    const text = question.trim()
    if (!text || busy.value) return
    busy.value = true
    messages.value.push({ role: 'user', text })
    // placeholder message fills up as the answer streams in
    const assistant = reactive<ChatMessage>({ role: 'assistant', text: '' })
    messages.value.push(assistant)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          q: text,
          scope: scope.value,
          // previous turns (everything except the question just pushed) —
          // used server-side for query rewriting and as LLM chat context
          history: messages.value.slice(0, -2).slice(-10).map(m => ({ role: m.role, text: m.text }))
        })
      })
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.statusMessage || `Chat request failed (${res.status})`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newline: number
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          if (!line) continue
          try {
            const evt = JSON.parse(line)
            if (evt.type === 'sources') assistant.sources = evt.sources
            else if (evt.type === 'delta') assistant.text += evt.text
            else if (evt.type === 'done') assistant.html = evt.html
            else if (evt.type === 'error') throw new Error(evt.message)
          } catch (e) {
            if (e instanceof SyntaxError) continue
            throw e
          }
        }
      }
    } catch (error: any) {
      const partial = assistant.text
      assistant.text = `⚠️ ${error?.message || 'Chat request failed'}`
      assistant.html = ''
      if (partial) assistant.text += `\n\n${partial}`
    } finally {
      busy.value = false
    }
  }

  function reset() {
    messages.value = []
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

  return { open, busy, messages, scope, scopeLabel, ask, reset, setScope, openGlobal, openFolder, toggleDrawer }
})