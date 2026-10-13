export interface ViewerFile {
  id: string
  filename: string
  mime: string
  size?: number
}

/** global file viewer state (nav, panels, search results all share it) */
export function useFileViewer() {
  const current = useState<ViewerFile | null>('file-viewer', () => null)
  return {
    current,
    open: (file: ViewerFile) => {
      current.value = file
    },
    close: () => {
      current.value = null
    }
  }
}