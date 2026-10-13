export default defineNuxtRouteMiddleware(async (to) => {
  const auth = useAuthStore()
  if (!auth.checked) await auth.fetchMe()
  const publicRoutes = ['/login']
  if (!auth.user && !publicRoutes.includes(to.path)) {
    return navigateTo('/login')
  }
  if (auth.user && to.path === '/login') {
    return navigateTo('/wiki')
  }
})