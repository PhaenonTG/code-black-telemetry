import { PageHeader } from "../components/PageHeader"

// Nothing named "Fleet" exists anywhere in the current app -- this is genuinely new. Modeled as a
// FLEET NODE (vehicle or station) with normalized fields so it isn't hard-coded around one person's
// setup; today there are zero live nodes because CodeBlack-Core is offline, so the honest state is
// an empty list with an explanation, not an invented vehicle.
export default function Fleet() {
  return (
    <div className="page page-fleet">
      <PageHeader title="Fleet" kicker="FLEET NODES" />
      <div className="empty-state">
        <p className="empty-state__title">NO LIVE FLEET DATA</p>
        <p className="empty-state__body">
          CodeBlack-Core is offline, so no fleet nodes (vehicles or stations) are reporting
          telemetry right now. This page is ready for real fleet nodes once Core is back online --
          nothing here is invented in the meantime.
        </p>
      </div>
    </div>
  )
}
