export interface MoveTarget {
  kind: 'file' | 'page' | 'folder'
  /** files: their id */
  id?: string
  /** pages/folders: their wiki path */
  path?: string
  /** display name */
  name: string
  /** current parent folder (for preselecting the picker) */
  dir?: string
}

/** global move dialog state (tree rows, folder pages and the page editor share it) */
export function useMove() {
  const current = useState<MoveTarget | null>('move-target', () => null)
  return {
    current,
    open: (target: MoveTarget) => {
      current.value = target
    },
    close: () => {
      current.value = null
    }
  }
}