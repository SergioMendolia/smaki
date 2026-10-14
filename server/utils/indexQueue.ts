import crypto from 'node:crypto'
import { fullReindex, indexFile, syncAll } from './indexer'

export interface IndexJob {
  id: string
  type: 'file' | 'sync' | 'full'
  label: string
  /** relative content path, file jobs only */
  rel?: string
  /** md5 of rel (the files-table id), file jobs only */
  fileId?: string
  status: 'queued' | 'running' | 'done' | 'error'
  progress?: string
  error?: string
  queuedAt: number
  startedAt?: number
  finishedAt?: number
}

/** finished jobs kept for the admin overview */
const HISTORY_LIMIT = 20

const queued: IndexJob[] = []
const history: IndexJob[] = []
let current: IndexJob | null = null
let pumping = false

function newId(): string {
  return crypto.randomUUID()
}

/** serialize state for the admin API */
export function queueState() {
  return {
    current,
    queued: queued.slice(),
    recent: history.slice(0, HISTORY_LIMIT)
  }
}

/** enqueue a single file reindex; refuses duplicates (queued or running) */
export function enqueueFile(rel: string, fileId?: string): IndexJob {
  const pending = (current && current.type === 'file' && current.rel === rel) ||
    queued.some(j => j.type === 'file' && j.rel === rel)
  if (pending) {
    throw createError({ statusCode: 409, statusMessage: `${rel} is already queued` })
  }
  const job: IndexJob = {
    id: newId(),
    type: 'file',
    label: rel,
    rel,
    fileId,
    status: 'queued',
    queuedAt: Date.now()
  }
  queued.push(job)
  void pump()
  return job
}

/** enqueue an incremental sync or a full reindex (wipes the collections first) */
export function enqueueSync(full: boolean): IndexJob {
  const job: IndexJob = {
    id: newId(),
    type: full ? 'full' : 'sync',
    label: full ? 'Full reindex' : 'Incremental sync',
    status: 'queued',
    queuedAt: Date.now()
  }
  queued.push(job)
  void pump()
  return job
}

/** process the queue serially; one job at a time, no two indexers in parallel */
async function pump(): Promise<void> {
  if (pumping) return
  pumping = true
  try {
    while (queued.length) {
      const job = queued.shift()!
      current = job
      job.status = 'running'
      job.startedAt = Date.now()
      try {
        if (job.type === 'file' && job.rel) {
          await indexFile(job.rel, message => (job.progress = message))
        } else if (job.type === 'full') {
          await fullReindex()
        } else {
          await syncAll()
        }
        job.status = 'done'
      } catch (error: any) {
        job.status = 'error'
        job.error = error?.statusMessage || error?.message || 'indexing failed'
      }
      job.finishedAt = Date.now()
      job.progress = undefined
      history.unshift(job)
      if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT
      current = null
    }
  } finally {
    pumping = false
    current = null
  }
}