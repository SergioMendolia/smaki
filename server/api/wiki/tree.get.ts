import { buildTree, ensureDirNode, sortTree, walkContent, type TreeNode } from '../../utils/content'
import { requireUser } from '../../utils/auth'
import { tables, useDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  requireUser(event)
  const { pages, dirs } = await walkContent()
  const tree: TreeNode = buildTree(pages)

  // physical folders materialize as nodes, even when empty
  for (const dir of dirs) {
    ensureDirNode(tree, dir)
  }

  const rows = useDb()
    .select({
      id: tables.files.id,
      dir: tables.files.dir,
      filename: tables.files.filename,
      mime: tables.files.mime
    })
    .from(tables.files)
    .all()

  for (const row of rows) {
    const target = ensureDirNode(tree, row.dir!)
    target.docs.push({ id: row.id, dir: row.dir!, filename: row.filename, mime: row.mime })
  }
  sortTree(tree)
  return tree
})