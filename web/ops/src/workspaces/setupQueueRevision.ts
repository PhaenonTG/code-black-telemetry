/** A freshly opened current detail can be newer than the last index collection. */
export function setupQueueRevision(row: { setup_id: string; revision: number }, detail: { setup_id: string; revision: number; is_current_revision?: boolean } | null): number {
  return detail?.setup_id === row.setup_id && detail.is_current_revision !== false
    ? Math.max(row.revision, detail.revision) : row.revision
}
