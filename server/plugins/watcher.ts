import path from 'node:path'
import chokidar from 'chokidar'
import { syncAll } from '../utils/indexer'

/** dev only: watch the content dir and re-sync the index on changes */
export default defineNitroPlugin(() => {
  if (!import.meta.dev) return
  const config = useRuntimeConfig()
  const root = path.resolve(config.contentDir)
  let timer: ReturnType<typeof setTimeout> | null = null
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(async () => {
      try {
        const stats = await syncAll()
        console.log('[smaki] watcher sync:', stats)
      } catch (error) {
        console.error('[smaki] watcher sync failed:', error)
      }
    }, 800)
  }
  chokidar
    .watch(root, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 300 } })
    .on('all', schedule)
  console.log(`[smaki] dev watcher active on ${root}`)
})