/** Reviewed vocabulary only. Raw event text, paths and URLs never enter this view. */
export const PROJECTS = {
  "radar-aegis": "Radar & AEGIS",
  "broadcast-producer": "Broadcast & Producer",
  infrastructure: "Infrastructure & recovery",
} as const
export const LABELS = {
  RADAR_REVIEW: "Radar candidate review; preserve the deployed V2 worker and calibrated assets.",
  STUDIO_LOCAL: "Content Studio local milestone; preserve source media and prior exports.",
  PRIVATE_OPS: "Private OPS coordination view in an isolated development copy.",
  RADAR_FILES: "Radar candidate and calibrated reference assets",
  STUDIO_FILES: "Content Studio approved output scope",
  OPS_FILES: "Private OPS coordination component and gateway adapter",
  LOG_FILES: "Canonical coordination documentation and session events",
  BROWSER_QA: "Browser quality checks",
  REGRESSION: "Regression tests",
  SNAPSHOT_TESTS: "Snapshot contract and private route tests",
  HANDOFF_ONLY: "Results are reported in a saved handoff; live state has not been rechecked.",
  NODE_QUALIFICATION: "Runtime qualification remains outstanding.",
  PUBLICATION_HELD: "Publication and deployment remain held.",
  REVIEW_REQUIRED: "Coordinator review required before the next step.",
  CURRENT_CHECK: "Obtain current owner and runtime evidence.",
  REVIEW_PREVIEW: "Review the isolated private OPS preview and evidence.",
  NO_DEPLOY: "No deployment performed for this work.",
  PRESERVE_V2: "Preserve the existing V2 worker and rollback assets.",
  ORIGINAL_UNCHANGED: "Original source worktree remains unchanged.",
  MISSING_STOP: "Current stop and ownership acknowledgement are unavailable.",
  NO_FRESHNESS_POLICY: "No approved freshness policy; export time does not refresh evidence.",
  CONFLICT: "Overlapping ownership requires coordinator reconciliation.",
} as const
export type LabelCode = keyof typeof LABELS
export type ProjectId = keyof typeof PROJECTS
export type EvidenceClass = "VERIFIED" | "REPORTED" | "UNVERIFIED"
export interface CoordinationSession {
  session_id: string; project_id: ProjectId; audit_ids: string[]; scope: LabelCode
  owner_role: "WORKER" | "COORDINATOR_OBSERVER"; review_state: "UNKNOWN" | "IN_PROGRESS" | "READY_FOR_REVIEW" | "STOP_REPORTED"
  observed_at_utc: string; reported_at_utc: string | null; evidence_class: EvidenceClass
  evidence_ids: string[]; owned_labels: LabelCode[]; commit: string | null
  changes: LabelCode[]; tests: Array<{ label: LabelCode; result: "PASS" | "FAIL" | "NOT_RUN"; evidence_class: EvidenceClass; observed_at_utc: string }>
  deployment: "NONE" | "NOT_DEPLOYED" | "REPORTED" | "VERIFIED" | "UNKNOWN"
  rollback: LabelCode; blockers: LabelCode[]; next_actions: LabelCode[]
}
export interface CoordinationView {
  schema_version: "codeblack.coordination.view.v1"; generated_at_utc: string; source_observed_at_utc: string
  source_snapshot_id: string; export_state: "AVAILABLE"; evidence_ids: string[]
  stale_state: { state: "UNKNOWN" | "STALE"; reason: LabelCode }
  sessions: CoordinationSession[]
  queue: Array<{ request_id: string; session_id: string; project_id: ProjectId; state: "QUEUED" | "ASSIGNED" | "RELEASE_REQUESTED" | "RELEASED" | "BLOCKED"; observed_at_utc: string; evidence_class: EvidenceClass; evidence_ids: string[]; decision_id: string | null }>
}

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
const id = /^[a-z0-9][a-z0-9-]{0,79}$/
function fail(): never { throw new Error("Coordination snapshot is invalid") }
function obj(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail()
  const o = value as Record<string, unknown>
  if (Object.keys(o).some(k => !keys.includes(k)) || keys.some(k => !(k in o))) return fail()
  return o
}
function str(v: unknown, regex: RegExp): string { if (typeof v !== "string" || !regex.test(v)) return fail(); return v }
function choice(v: unknown, values: readonly string[]): string { if (typeof v !== "string" || !values.includes(v)) return fail(); return v }
function arr(v: unknown, check: (x: unknown) => unknown): unknown[] { if (!Array.isArray(v) || v.length > 100) return fail(); v.forEach(check); return v }
function timestamp(v: unknown): string { const t = str(v, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/); if (!Number.isFinite(Date.parse(t)) || new Date(t).toISOString() !== t) return fail(); return t }
function label(v: unknown) { return choice(v, Object.keys(LABELS)) }
function evidence(v: unknown) { return choice(v, ["VERIFIED", "REPORTED", "UNVERIFIED"]) }

export function validateCoordination(value: unknown): CoordinationView {
  const o = obj(value, ["schema_version", "generated_at_utc", "source_observed_at_utc", "source_snapshot_id", "export_state", "evidence_ids", "stale_state", "sessions", "queue"])
  choice(o.schema_version, ["codeblack.coordination.view.v1"]); choice(o.export_state, ["AVAILABLE"])
  const generated = timestamp(o.generated_at_utc), observed = timestamp(o.source_observed_at_utc)
  if (observed > generated) return fail()
  str(o.source_snapshot_id, /^[0-9a-f]{64}$/)
  arr(o.evidence_ids, x => str(x, id)); const ids = o.evidence_ids as string[]
  if (new Set(ids).size !== ids.length) return fail()
  const refs = (v: unknown) => arr(v, x => { if (!ids.includes(str(x, id))) return fail() })
  const stale = obj(o.stale_state, ["state", "reason"]); choice(stale.state, ["UNKNOWN", "STALE"]); label(stale.reason)
  const sessions = new Set<string>()
  arr(o.sessions, v => {
    const s = obj(v, ["session_id", "project_id", "audit_ids", "scope", "owner_role", "review_state", "observed_at_utc", "reported_at_utc", "evidence_class", "evidence_ids", "owned_labels", "commit", "changes", "tests", "deployment", "rollback", "blockers", "next_actions"])
    const sid = str(s.session_id, uuid); if (sessions.has(sid)) return fail(); sessions.add(sid)
    choice(s.project_id, Object.keys(PROJECTS)); arr(s.audit_ids, x => str(x, /^CBWX-(00[1-9]|0[12][0-9]|03[01])$/)); label(s.scope)
    choice(s.owner_role, ["WORKER", "COORDINATOR_OBSERVER"]); choice(s.review_state, ["UNKNOWN", "IN_PROGRESS", "READY_FOR_REVIEW", "STOP_REPORTED"])
    if (timestamp(s.observed_at_utc) > observed) return fail()
    if (s.reported_at_utc !== null && timestamp(s.reported_at_utc) > observed) return fail()
    evidence(s.evidence_class); refs(s.evidence_ids); if (!(s.evidence_ids as unknown[]).length) return fail()
    for (const key of ["owned_labels", "changes", "blockers", "next_actions"]) arr(s[key], label)
    if (s.commit !== null) str(s.commit, /^[0-9a-f]{40}$/)
    choice(s.deployment, ["NONE", "NOT_DEPLOYED", "REPORTED", "VERIFIED", "UNKNOWN"]); label(s.rollback)
    arr(s.tests, v => { const t = obj(v, ["label", "result", "evidence_class", "observed_at_utc"]); label(t.label); choice(t.result, ["PASS", "FAIL", "NOT_RUN"]); evidence(t.evidence_class); if (timestamp(t.observed_at_utc) > observed) return fail() })
  })
  const requests = new Set<string>(); let assigned = 0
  arr(o.queue, v => {
    const q = obj(v, ["request_id", "session_id", "project_id", "state", "observed_at_utc", "evidence_class", "evidence_ids", "decision_id"])
    const rid = str(q.request_id, id); if (requests.has(rid)) return fail(); requests.add(rid)
    if (!sessions.has(str(q.session_id, uuid))) return fail()
    choice(q.project_id, Object.keys(PROJECTS)); choice(q.state, ["QUEUED", "ASSIGNED", "RELEASE_REQUESTED", "RELEASED", "BLOCKED"])
    if (timestamp(q.observed_at_utc) > observed) return fail(); evidence(q.evidence_class); refs(q.evidence_ids)
    if (!(q.evidence_ids as unknown[]).length) return fail()
    if (q.decision_id !== null) str(q.decision_id, id)
    if (["ASSIGNED", "RELEASED"].includes(q.state as string) && !q.decision_id) return fail()
    if (q.state === "ASSIGNED" && ++assigned > 1) return fail()
  })
  return value as CoordinationView
}
