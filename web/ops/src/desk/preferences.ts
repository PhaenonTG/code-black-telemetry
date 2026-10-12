export type Workspace = "producer" | "chase" | "analysis"
export type AnalysisMode = "setup" | "surveillance"
export type DeskPreferences = {
  version: 1
  workspace: Workspace
  analysisMode: AnalysisMode
  unitId: string
  primaryCameraId: string
  snapshotMode: boolean
}

export const DESK_PREFERENCES_KEY = "codeblack.ops.desk.v1"
export const CAMERA_WALL_KEY = "codeblack.ops.cameraWall"
export const DEFAULT_DESK_PREFERENCES: DeskPreferences = {
  version: 1, workspace: "producer", analysisMode: "setup", unitId: "", primaryCameraId: "", snapshotMode: false,
}

export function normalizePreferences(value: unknown): DeskPreferences {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {}
  return {
    version: 1,
    workspace: row.workspace === "chase" || row.workspace === "analysis" ? row.workspace : "producer",
    analysisMode: row.analysisMode === "surveillance" ? "surveillance" : "setup",
    unitId: typeof row.unitId === "string" ? row.unitId.slice(0, 120) : "",
    primaryCameraId: typeof row.primaryCameraId === "string" ? row.primaryCameraId.slice(0, 250) : "",
    snapshotMode: row.snapshotMode === true,
  }
}

export function readDeskPreferences(): DeskPreferences {
  try {
    const raw = localStorage.getItem(DESK_PREFERENCES_KEY)
    return raw ? normalizePreferences(JSON.parse(raw)) : { ...DEFAULT_DESK_PREFERENCES, snapshotMode: localStorage.getItem("codeblack.ops.cameraSnapshotMode") === "true" }
  } catch { return { ...DEFAULT_DESK_PREFERENCES } }
}

export function persistDeskPreferences(value: DeskPreferences) {
  try { localStorage.setItem(DESK_PREFERENCES_KEY, JSON.stringify(value)) } catch { /* Session state remains usable. */ }
}
