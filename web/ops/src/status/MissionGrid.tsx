import { memo, useMemo, useState } from "react"
import { StatusDisclosure } from "./StatusDisclosure"
import { StatusBadge } from "../components/StatusBadge"
import { chaseReadiness, hostImpacts, projectHealthCounts } from "./missionModel"
import type { StatusCenterDocument, StatusProject } from "./statusCenterClient"
import "./mission-grid.css"

function badge(state: string): "LIVE" | "DEGRADED" | "UNAVAILABLE" | "CHECKING" {
  if (state === "HEALTHY" || state === "PASS" || state === "READY") return "LIVE"
  if (state === "DEGRADED" || state === "WATCH" || state === "CHECK") return "DEGRADED"
  if (state === "OFFLINE" || state === "BLOCKED" || state === "HOLD") return "UNAVAILABLE"
  return "CHECKING"
}

function timeLabel(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"
}

export const MissionGrid = memo(function MissionGrid({ document, error }: { document: StatusCenterDocument | null; error: string | null }) {
  const [filter, setFilter] = useState("all")
  const [query, setQuery] = useState("")
  const allProjects = document?.projects ?? []
  const projects = allProjects.filter((project) => project.registration !== "DISCOVERED")
  const discovered = allProjects.filter((project) => project.registration === "DISCOVERED")
  const coverage = document?.project_coverage
  const counts = projects.reduce((count, project) => {
    if (project.health === "HEALTHY") count.clear += 1
    else if (project.health === "UNMONITORED") count.unmonitored += 1
    else count.check += 1
    return count
  }, { clear: 0, check: 0, unmonitored: 0 })
  const impacts = useMemo(() => document ? hostImpacts(document) : [], [document])
  const readiness = useMemo(() => document ? chaseReadiness(document) : null, [document])

  const shown = projects.filter((project) => {
    const matches = filter === "all" || (filter === "healthy" ? project.health === "HEALTHY" : filter === "unmonitored" ? project.health === "UNMONITORED" : !["HEALTHY", "UNMONITORED"].includes(project.health))
    const search = query.trim().toLowerCase()
    return matches && (!search || [project.name, project.summary, ...project.services.map((service) => service.host)].join(" ").toLowerCase().includes(search))
  })
  return <>
    <section className="status-landscape" aria-label="Project landscape">
      <div className="status-landscape__header">
        <div><span className="status-landscape__eyebrow">CODE BLACK // MISSION GRID</span><h2>PROJECT LANDSCAPE</h2><p>Rollout phase and live service health across the operation.</p></div>
        <div className="status-landscape__counts" aria-label="Project health counts">
          <div><b>{projects.length}</b><span>PROJECTS</span></div><div><b>{counts.clear}</b><span>CLEAR</span></div>
          <div><b>{counts.check}</b><span>CHECK</span></div><div><b>{counts.unmonitored}</b><span>NO PROBE</span></div>
        </div>
      </div>
      <div className="mission-toolbar">
        <div className="mission-filters" role="group" aria-label="Filter projects">
          {[["all", "All", projects.length], ["attention", "Needs attention", counts.check], ["healthy", "Healthy", counts.clear], ["unmonitored", "No probe", counts.unmonitored]].map(([id, label, count]) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(String(id))}>{label} <span>{count}</span></button>)}
        </div>
        <input type="search" aria-label="Search projects" placeholder="Search project or host…" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      {error ? <p className="status-center__muted">Project health is unavailable while Core telemetry is disconnected.</p> : !document ? <p className="status-center__muted">Loading mission grid…</p> : projects.length === 0 ? <p className="status-center__muted">Core has not published the project landscape yet.</p> :
        <><p className="mission-result-count" role="status">{shown.length} of {projects.length} projects · expand for evidence and history</p>
        <div className="status-landscape__grid">{shown.map((project) => <ProjectCard key={project.id} project={project} />)}</div>
        {shown.length === 0 && <p className="mission-empty">No matching projects. <button type="button" onClick={() => { setFilter("all"); setQuery("") }}>Clear filters</button></p>}</>}

    </section>
    <StatusDisclosure className="mission-panel mission-coverage" label="Project discovery coverage" title={<><b>DEPLOYMENT WATCH</b><span>{error || !coverage ? "EVIDENCE UNAVAILABLE" : `${coverage.finding_count} TO REVIEW`}</span></>}>
      <div className="mission-panel__title"><span>AUTOMATIC REGISTRATION</span><h2>DEPLOYMENT WATCH <b>{coverage?.finding_count ?? "—"} TO REVIEW</b></h2></div>
      <p>Project manifests and running releases refresh automatically. Milestones describe plans; verified deployment status requires a matching clean Git record and current health evidence.</p>
      <div className="mission-coverage__hosts">{coverage?.hosts.map((host) => <span key={host.host}>{host.host.toUpperCase()} · {host.state}{host.observed_at ? ` · ${timeLabel(host.observed_at)}` : " · no discovery report"}</span>) ?? <span>Waiting for discovery coverage…</span>}</div>
      {error && <p>Core telemetry is disconnected; these observations may be stale.</p>}
      <details><summary>DISCOVERED PROJECTS / SERVICES · {discovered.length}</summary>
        {discovered.length ? <div className="mission-discovered">{discovered.map((project) => <article key={project.id}><b>{project.name}</b><span>{project.health} · UNVERIFIED</span><small>{project.services.map((service) => `${service.host} · ${service.name} · ${service.deployment?.release ?? "release unknown"}`).join(" / ")}</small><p>{project.note}</p></article>)}</div> : <p>No unregistered services in the available host reports.</p>}
      </details>
      <details><summary>COVERAGE FINDINGS · {coverage?.finding_count ?? 0}</summary><ul>{coverage?.findings.map((finding, i) => <li key={`${finding.kind}-${i}`}><b>{finding.kind.replaceAll("_", " ")}</b> · {finding.host ?? finding.project ?? "inventory"}<small>{finding.detail ?? "Check the project manifest."}</small></li>)}</ul></details>
    </StatusDisclosure>
    <StatusDisclosure className="mission-panel mission-insights" label="Operational checks" title={<><b>HOST IMPACT & CHASE READINESS</b><span>{error ? "EVIDENCE UNAVAILABLE" : readiness?.state ?? "CHECKING"}</span></>}>
    <div className="mission-ops-panels">
      <section className="mission-panel" aria-label="Shared host impact"><div className="mission-panel__title"><span>IMPACT RADAR</span><h2>SHARED HOST SIGNALS</h2></div><p>Host state and projects with weak signals on that host. Association does not prove the host caused a project issue.</p>
        {impacts.length === 0 ? <p>No host relationships available.</p> : <div className="mission-impact-list">{impacts.map((host) => <article key={host.id}><div><b>{host.name}</b><StatusBadge state={badge(host.state)} /></div><small>{host.state} · {host.affected.length} with weak signals of {host.projects.length} linked projects</small><p>{host.affected.length ? host.affected.join(" · ") : host.projects.join(" · ")}</p>{host.reason && <em>{host.reason}</em>}</article>)}</div>}
      </section>
      <section className="mission-panel" aria-label="Chase readiness"><div className="mission-panel__title"><span>PRE-FLIGHT</span><h2>CHASE SIGNALS <b>{readiness?.state ?? "UNKNOWN"}</b></h2></div><p>Telemetry checklist for launch decisions. It does not assess storm safety.</p>
        <div className="mission-check-list">{readiness?.checks.map((check) => <article key={check.id}><span className={`mission-check mission-check--${check.state.toLowerCase()}`}>{check.state}</span><div><b>{check.label}</b><small>{check.detail}</small></div></article>) ?? <p>Waiting for Core telemetry…</p>}</div>
      </section>
    </div>
    </StatusDisclosure>
  </>
})


const ProjectCard = memo(function ProjectCard({ project }: { project: StatusProject }) {
  const health = projectHealthCounts(project)
  return <article className={`status-landscape__card status-landscape__card--${project.health.toLowerCase()}`}>
    <div className="mission-card-heading"><h3>{project.name}</h3><span className={`mission-state mission-state--${project.health.toLowerCase()}`}>{project.health === "UNMONITORED" ? "NO PROBE" : project.health}</span></div>
            <div className="status-landscape__phase">{project.declared_phase ?? project.phase}</div><p>{project.summary}</p>

            <div className="status-landscape__score"><div><span>HEALTHY</span><b>{health.healthy} / {health.expected}</b></div><div><span>MONITORED</span><b>{health.monitored} / {health.expected}</b></div></div>
            <div className="status-landscape__meter" aria-label={`${health.healthy} of ${health.expected} scoped services healthy`}><i style={{ width: health.expected ? `${100 * health.healthy / health.expected}%` : "0%" }} /></div>
            {health.unknown > 0 && <p className="status-landscape__unknown">{health.unknown} service{health.unknown === 1 ? "" : "s"} awaiting current evidence</p>}
            <StatusDisclosure className="mission-project-details" label={`${project.name} details`} title={<b>INSPECT PROJECT</b>}>
              <ProjectEvidence project={project} />
            </StatusDisclosure>
          </article>
})

function ProjectEvidence({ project }: { project: StatusProject }) {
  const history = project.history
  return <>
            <div className="mission-deployment-state">DEPLOYMENT: {project.deployment_state ?? "UNVERIFIED"} · {project.registration ?? "REGISTRY"}</div>
            <div className="mission-history__label"><span>PAST 24 HOURS</span><small>{history?.observed_since ? `Sampling since ${timeLabel(history.observed_since)}` : "Collecting first sample"}</small></div>
            <div className="mission-history" role="img" aria-label={`24-hour sampled history for ${project.name}; gaps mean no recorded sample`}>
              {(history?.bins ?? Array.from({ length: 48 }, () => "NO_DATA")).map((state, i) => <i key={i} className={`mission-history__bin mission-history__bin--${state.toLowerCase()}`} title={`${state} · ${history ? new Date(Date.parse(history.window_start) + i * history.bin_seconds * 1000).toLocaleString() : "no sample"}`} />)}
            </div>
            <div className="mission-signals"><h4>SERVICE SIGNALS · {project.services.length}</h4><ul>{project.services.map((service) => <li key={service.id}><span>{service.name}<small>{service.host}{service.monitoring_kind === "PROCESS_ONLY" ? " · process check only" : ""}</small>{service.state_reason && <small className="mission-signal-reason">{service.state_reason}</small>}{service.deployment && <details className="mission-service-release"><summary>Deployment record · {service.deployment.state}</summary><small>{service.deployment.state} · {service.deployment.release ?? "release unavailable"}<br />{service.deployment.commit ? `Git ${service.deployment.commit.slice(0, 12)} · deployed ${service.deployment.deployed_at ? new Date(service.deployment.deployed_at).toLocaleString() : "time unknown"}` : "Awaiting a matching deployment record"}{service.deployment.last_attempt && <><br />Last attempt: {service.deployment.last_attempt.result} · {new Date(service.deployment.last_attempt.reported_at).toLocaleString()}</>}</small></details>}</span><b className={`status-landscape__signal status-landscape__signal--${service.state.toLowerCase()}`}>{service.state}</b></li>)}</ul>
              {project.missing_services.length > 0 && <p className="status-landscape__missing">Missing probes: {project.missing_services.join(", ")}</p>}
            </div>
            <p className="status-landscape__note">{project.note}</p>
            {project.links.length > 0 && <div className="status-landscape__links">{project.links.map((link) => <a key={link.id} href={link.url} target="_blank" rel="noreferrer">{link.name} ↗</a>)}</div>}
  </>
}
