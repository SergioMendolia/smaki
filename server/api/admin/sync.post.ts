import { ensureTypesense } from '../../utils/bootstrap'
import { fullReindex, syncAll } from '../../utils/indexer'
import { requireAdmin } from '../../utils/auth'

/** re-sync of the typesense index: incremental by default, ?full=true wipes and rebuilds */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  await ensureTypesense()
  if (getQuery(event).full === 'true') return await fullReindex()
  return await syncAll()
})