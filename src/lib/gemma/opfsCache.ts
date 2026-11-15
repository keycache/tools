import { clearOpfsDir, listOpfsEntries as listEntries, opfsDir, type DirProvider, type EntryMeta } from '@/lib/transformers/opfsCache'

/** Gemma's model files (+ the ORT runtime) live in this OPFS directory; the shared cache is in lib/transformers. */
export const OPFS_DIR = 'gemma-models'
export const gemmaDir: DirProvider = opfsDir(OPFS_DIR)

export { OpfsModelCache, isOpfsSupported, keyName, type DirLike, type EntryMeta, type FileLike } from '@/lib/transformers/opfsCache'

/** Lists Gemma's complete entries (or those of `getDir`). */
export function listOpfsEntries(getDir: DirProvider = gemmaDir): Promise<EntryMeta[]> {
  return listEntries(getDir)
}

/** Removes Gemma's model directory. */
export function clearOpfsEntries(): Promise<void> {
  return clearOpfsDir(OPFS_DIR)
}
