let chase: Promise<typeof import("../pages/ChaseWorkspace")> | undefined
let analysis: Promise<typeof import("../pages/AnalysisWorkspace")> | undefined

// Navigation intent and React.lazy share one pending import; a failure can be retried.
export function loadChaseWorkspace() {
  return chase ??= import("../pages/ChaseWorkspace").catch(error => { chase = undefined; throw error })
}
export function loadAnalysisWorkspace() {
  return analysis ??= import("../pages/AnalysisWorkspace").catch(error => { analysis = undefined; throw error })
}
export function prefetchWorkspaceRoute(path: string) {
  const pathname = path.split(/[?#]/)[0]
  const load = /^\/chase-desk(\/|$)/.test(pathname) ? loadChaseWorkspace
    : /^\/(setup-review|analysis|chase-setups)(\/|$)/.test(pathname) ? loadAnalysisWorkspace : null
  return load?.().catch(() => undefined)
}
export function prefetchLinkedWorkspace(event: { target: EventTarget | null }) {
  if (typeof Element === "undefined" || !(event.target instanceof Element)) return
  const path = event.target.closest("a[href]")?.getAttribute("href")
  if (path) return prefetchWorkspaceRoute(path)
}
