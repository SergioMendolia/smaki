<script setup lang="ts">
import { useChatStore } from '~/stores/chat'

const chat = useChatStore()
const question = ref('')
const scrollRef = ref<HTMLElement | null>(null)

async function send() {
  const q = question.value
  question.value = ''
  await chat.ask(q)
  await nextTick()
  scrollRef.value?.scrollTo({ top: scrollRef.value.scrollHeight })
}

watch(
  () => [chat.messages.length, chat.messages[chat.messages.length - 1]?.text],
  async () => {
    await nextTick()
    scrollRef.value?.scrollTo({ top: scrollRef.value.scrollHeight })
  }
)

function sourceLink(path: string) {
  return `/wiki/${path}`
}

// collapsed by default, per-message index
const openSources = ref(new Set<number>())
function toggleSources(i: number) {
  const next = new Set(openSources.value)
  if (next.has(i)) next.delete(i)
  else next.add(i)
  openSources.value = next
}
</script>

<template>
  <USlideover :open="chat.open" side="right" :ui="{ content: 'max-w-lg' }" @update:open="chat.toggleDrawer($event)">
    <template #content>
      <div class="flex h-full flex-col">
        <div class="flex items-center gap-2 border-b border-default p-4">
          <UIcon name="i-lucide-sparkles" class="h-5 w-5 text-primary" />
          <h2 class="font-semibold">{{ chat.scopeLabel ? `Ask in ${chat.scopeLabel}` : 'Ask the wiki' }}</h2>
          <UBadge v-if="chat.scopeLabel" color="primary" variant="subtle" size="sm">
            {{ chat.scopeLabel }}/
          </UBadge>
          <UButton
            class="ms-auto"
            color="neutral"
            variant="ghost"
            icon="i-lucide-plus"
            label="New chat"
            @click="chat.reset()"
          />
        </div>

        <div ref="scrollRef" class="flex-1 space-y-4 overflow-y-auto p-4">
          <div v-if="!chat.messages.length" class="mt-8 text-center text-sm text-muted">
            <template v-if="chat.scopeLabel">
              Answers come only from the pages and documents in
              <span class="font-semibold text-highlighted">{{ chat.scopeLabel }}/</span>.
            </template>
            <template v-else>
              Ask anything about your family wiki — answers come from the indexed pages and documents.
              <div class="mt-3">e.g. “What ingredients do I need for the paella?”</div>
            </template>
          </div>

          <div
            v-for="(message, i) in chat.messages"
            :key="i"
            class="flex"
            :class="message.role === 'user' ? 'justify-end' : 'justify-start'"
          >
            <div
              class="max-w-[85%] rounded-lg px-3 py-2 text-sm"
              :class="message.role === 'user'
                ? 'whitespace-pre-wrap bg-primary text-inverted'
                : message.html ? 'bg-elevated' : 'whitespace-pre-wrap bg-elevated'"
            >
              <div v-if="message.html" class="chat-md" v-html="message.html" />
              <template v-else-if="message.text">{{ message.text }}</template>
              <div v-else-if="chat.busy" class="text-muted">Thinking…</div>
              <div v-if="message.sources?.length" class="mt-2">
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  :icon="openSources.has(i) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                  :label="`Sources (${message.sources.length})`"
                  :ui="{ label: 'text-dimmed' }"
                  @click="toggleSources(i)"
                />
                <div v-show="openSources.has(i)" class="mt-1 flex flex-wrap gap-1">
                  <UBadge
                    v-for="source in message.sources"
                    :key="source.type + source.path + (source.filename ?? '')"
                    color="neutral"
                    variant="subtle"
                    class="cursor-pointer"
                    @click="navigateTo(sourceLink(source.path))"
                  >
                    {{ source.type === 'page' ? source.title || source.path : source.filename }}
                  </UBadge>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="border-t border-default p-4">
          <UTextarea
            v-model="question"
            :rows="2"
            autoresize
            placeholder="Ask a question…"
            class="w-full"
            @keydown.enter.exact.prevent="send"
          />
          <div class="mt-2 flex justify-end">
            <UButton icon="i-lucide-send" :loading="chat.busy" :disabled="!question.trim()" @click="send">
              Send
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </USlideover>
</template>