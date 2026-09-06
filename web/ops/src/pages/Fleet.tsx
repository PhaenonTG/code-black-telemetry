import { PageHeader } from "../components/PageHeader"
import { useCoreOps } from "../core/useCoreOps"

// Nothing named "Fleet" exists anywhere in the current app -- this is genuinely new. Modeled as a
// FLEET NODE (vehicle or station) with normalized fields so it isn't hard-coded around one person's
// setup; today there are zero live nodes because CodeBlack-Core is offline, so the honest state is
// an empty list with an explanation, not an invented vehicle.
export default function Fleet() {
  const { state } = useCoreOps()
  const units = state.fabric.units?.units ?? []

  return (
    <div className="page page-fleet">
      <PageHeader title="FLEET" kicker="FABRIC UNIT STATE" />
      {units.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state__title">NO FABRIC UNIT SNAPSHOT</p>
          <p className="empty-state__body">
            {state.fabric.detail}. Vehicle physical integration remains deferred; missing STRIKER or TESSA telemetry is not treated as failure in this shell.
          </p>
        </div>
      ) : (
        <div className="ops-fleet-grid">
          {units.map((unit) => (
            <section className="ops-fleet-card" key={unit.unit_id}>
              <p>{unit.role}</p>
              <h2>{unit.operator_name || unit.display_name}</h2>
              <b>{unit.overall_health}</b>
              <span>{unit.devices.length} devices registered</span>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
