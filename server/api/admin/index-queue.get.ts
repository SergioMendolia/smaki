import { requireAdmin } from '../../utils/auth'
import { queueState } from '../../utils/indexQueue'

/** live indexing queue: current job, pending jobs and recent results */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  return queueState()
})