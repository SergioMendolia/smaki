<script setup lang="ts">
import { useAuthStore } from '~/stores/auth'
import { useChatStore } from '~/stores/chat'
import { useSearchStore } from '~/stores/search'
import { useTreeStore } from '~/stores/tree'

const auth = useAuthStore()
const chat = useChatStore()
const search = useSearchStore()
const tree = useTreeStore()
const siteName = useRuntimeConfig().public.siteName

watch(
  () => auth.user,
  (user) => {
    if (user) tree.fetchTree()
  },
  { immediate: true }
)

const userMenu = computed(() => [
  [{ label: auth.user?.name ?? '', disabled: true }],
  [
    ...(auth.user?.role === 'admin'
      ? [
          {
            label: 'Administration',
            icon: 'i-lucide-settings',
            onSelect: () => navigateTo('/admin')
          }
        ]
      : []),
    {
      label: 'Sign out',
      icon: 'i-lucide-log-out',
      onSelect: () => auth.logout()
    }
  ]
])
</script>

<template>
  <div class="min-h-screen">
    <header class="sticky top-0 z-40 border-b border-default bg-default/80 backdrop-blur">
      <div class="flex h-14 items-center gap-3 px-4">
        <NuxtLink :to="auth.user ? '/wiki' : '/'" class="text-lg font-bold text-primary">
          {{ siteName }}
        </NuxtLink>
        <UButton
          v-if="auth.user"
          icon="i-lucide-search"
          color="neutral"
          variant="ghost"
          @click="search.openPalette(true)"
        >
          Search
          <UKbd value="⌘K" />
        </UButton>
        <div class="ms-auto flex items-center gap-1">
          <UButton
            v-if="auth.user"
            icon="i-lucide-message-circle"
            color="neutral"
            variant="ghost"
            :class="chat.open ? 'text-primary' : ''"
            @click="chat.openGlobal()"
          />
          <UDropdownMenu v-if="auth.user" :items="userMenu">
            <UButton color="neutral" variant="ghost" icon="i-lucide-user" :label="auth.user.name" />
          </UDropdownMenu>
        </div>
      </div>
    </header>

    <div class="flex">
      <aside
        v-if="auth.user"
        class="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 overflow-y-auto border-e border-default p-2 lg:block"
      >
        <WikiTree />
      </aside>
      <main class="min-w-0 flex-1 p-4 sm:p-6">
        <slot />
      </main>
    </div>

    <SearchPalette />
    <ChatDrawer />
    <MoveFileDialog />
  </div>
</template>