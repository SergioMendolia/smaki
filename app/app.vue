<script setup lang="ts">
// key the catch-all wiki route by full path so navigating between pages,
// folders and documents remounts the component and refetches fresh content
const route = useRoute()
const pageKey = computed(() => route.fullPath)
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage :page-key="pageKey" />
    </NuxtLayout>
  </UApp>
</template>