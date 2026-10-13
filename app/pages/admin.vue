<script setup lang="ts">
import { useAuthStore } from '~/stores/auth'

interface AdminUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'member'
  createdAt: string
  lastAdmin: boolean
}

definePageMeta({
  middleware: [
    function () {
      const auth = useAuthStore()
      if (auth.checked && auth.user?.role !== 'admin') return navigateTo('/wiki')
    }
  ]
})

const auth = useAuthStore()
if (auth.checked && auth.user?.role !== 'admin') await navigateTo('/wiki')

const toast = useToast()
const users = ref<AdminUser[]>([])

async function load() {
  users.value = await $fetch<AdminUser[]>('/api/admin/users')
}
await load()

const me = computed(() => auth.user)

// --- user form (create + edit) ---
const formOpen = ref(false)
const editing = ref<AdminUser | null>(null)
const form = reactive({ email: '', name: '', password: '', role: 'member' as 'admin' | 'member' })
const formBusy = ref(false)

function openCreate() {
  editing.value = null
  Object.assign(form, { email: '', name: '', password: '', role: 'member' })
  formOpen.value = true
}

function openEdit(user: AdminUser) {
  editing.value = user
  Object.assign(form, { email: user.email, name: user.name, password: '', role: user.role })
  formOpen.value = true
}

async function submitForm() {
  formBusy.value = true
  try {
    if (editing.value) {
      await $fetch(`/api/admin/users/${editing.value.id}`, {
        method: 'PUT',
        body: { name: form.name, role: form.role, ...(form.password ? { password: form.password } : {}) }
      })
      toast.add({ title: 'User updated' })
    } else {
      await $fetch('/api/admin/users', {
        method: 'POST',
        body: { ...form }
      })
      toast.add({ title: 'User created' })
    }
    formOpen.value = false
    await load()
  } catch (error: any) {
    toast.add({ title: 'Save failed', description: error?.data?.statusMessage || error?.message, color: 'error' })
  } finally {
    formBusy.value = false
  }
}

async function removeUser(user: AdminUser) {
  if (!confirm(`Delete “${user.name}” (${user.email})? Their account and sessions will be removed.`)) return
  try {
    await $fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' })
    toast.add({ title: 'User deleted' })
    await load()
  } catch (error: any) {
    toast.add({ title: 'Delete failed', description: error?.data?.statusMessage || error?.message, color: 'error' })
  }
}

// --- indexing ---
const indexing = ref<'' | 'incremental' | 'full'>('')

async function reindex(full = false) {
  if (full && !confirm('Full reindex: every page and document will be wiped from the search index and re-embedded. This can take a while. Continue?')) return
  indexing.value = full ? 'full' : 'incremental'
  try {
    const stats = await $fetch('/api/admin/sync', { method: 'POST', query: full ? { full: 'true' } : {} })
    toast.add({
      title: full ? 'Full reindex complete' : 'Index synced',
      description: `${stats.pagesIndexed} pages and ${stats.filesIndexed} documents indexed, ${stats.pagesDeleted + stats.filesDeleted} removed`
    })
  } catch (error: any) {
    toast.add({ title: 'Reindex failed', description: error?.data?.statusMessage || error?.message, color: 'error' })
  } finally {
    indexing.value = ''
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-8">
    <div>
      <h1 class="text-2xl font-bold">Administration</h1>
      <p class="mt-1 text-sm text-muted">Users and search index.</p>
    </div>

    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-users" class="h-5 w-5 text-muted" />
          <h2 class="font-semibold">Users</h2>
          <UButton class="ms-auto" size="xs" icon="i-lucide-user-plus" label="Add user" @click="openCreate" />
        </div>
      </template>

      <ul class="divide-y divide-default">
        <li v-for="user in users" :key="user.id" class="flex items-center gap-3 py-2.5">
          <div class="min-w-0 flex-1">
            <p class="flex items-center gap-2 text-sm font-medium">
              {{ user.name }}
              <UBadge :color="user.role === 'admin' ? 'primary' : 'neutral'" variant="subtle" size="sm">
                {{ user.role }}
              </UBadge>
              <span v-if="user.id === me?.id" class="text-xs text-muted">(you)</span>
            </p>
            <p class="truncate text-xs text-muted">{{ user.email }}</p>
          </div>
          <UButton
            size="xs"
            variant="ghost"
            icon="i-lucide-pencil"
            :aria-label="`Edit ${user.name}`"
            @click="openEdit(user)"
          />
          <UButton
            size="xs"
            variant="ghost"
            color="error"
            icon="i-lucide-trash-2"
            :aria-label="`Delete ${user.name}`"
            :disabled="user.id === me?.id || user.lastAdmin"
            @click="removeUser(user)"
          />
        </li>
      </ul>
    </UCard>

    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-database" class="h-5 w-5 text-muted" />
          <h2 class="font-semibold">Search index</h2>
        </div>
      </template>

      <div class="flex flex-wrap items-center gap-3">
        <UButton
          icon="i-lucide-refresh-cw"
          label="Re-index wiki"
          :loading="indexing === 'incremental'"
          :disabled="!!indexing"
          @click="reindex(false)"
        />
        <UButton
          color="error"
          variant="soft"
          icon="i-lucide-flame"
          label="Full reindex"
          :loading="indexing === 'full'"
          :disabled="!!indexing"
          @click="reindex(true)"
        />
        <p class="w-full text-xs text-muted">
          Re-index only processes changed files (fast). A full reindex wipes the search index and
          re-embeds every page and document from scratch.
        </p>
      </div>
    </UCard>

    <UModal :open="formOpen" @update:open="formOpen = $event">
      <template #content>
        <form class="p-6" @submit.prevent="submitForm">
          <h2 class="text-lg font-semibold">{{ editing ? `Edit ${editing.name}` : 'Add user' }}</h2>
          <div class="mt-4 space-y-3">
            <UFormField v-if="!editing" label="Email" required>
              <UInput v-model="form.email" type="email" class="w-full" autofocus required />
            </UFormField>
            <UFormField label="Name" required>
              <UInput v-model="form.name" class="w-full" required />
            </UFormField>
            <UFormField :label="editing ? 'New password (leave empty to keep)' : 'Password'" :required="!editing">
              <UInput v-model="form.password" type="password" class="w-full" :required="!editing" minlength="8" />
            </UFormField>
            <UFormField label="Role">
              <USelect
                v-model="form.role"
                :items="[
                  { label: 'Member', value: 'member' },
                  { label: 'Admin', value: 'admin' }
                ]"
                class="w-full"
                :disabled="editing?.lastAdmin"
              />
            </UFormField>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <UButton type="button" variant="ghost" label="Cancel" @click="formOpen = false" />
            <UButton type="submit" icon="i-lucide-check" :loading="formBusy">
              {{ editing ? 'Save' : 'Create' }}
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>