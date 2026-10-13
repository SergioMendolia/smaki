import { ensureTypesense } from '../utils/bootstrap'
import { syncAll } from '../utils/indexer'

/** on boot: init db (migrations), ensure typesense collections + conversation model, sync the index */
export default defineNitroPlugin(async () => {
  useDb()
  let attempts = 0
  const attempt = async () => {
    try {
      await ensureTypesense()
      const stats = await syncAll()
      console.log('[smaki] index synced:', stats)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[smaki] typesense bootstrap failed: ${message}`)
      if (++attempts < 30) {
        console.log('[smaki] retrying typesense bootstrap in 30s...')
        setTimeout(attempt, 30_000)
      }
    }
  }
  await attempt()
})