import type { NormalizedMetric } from "../../../../web/overlay/src/stormIntel/types";
import { formatMetric, metricThreatLevel, sourceSemantics } from "../stormIntel/format";
import { metricsForGroup, STORM_METRIC_GROUPS } from "../stormIntel/groups";
import type { OpsCoreState } from "../core/types";

function MetricRow({ metric }: { metric: NormalizedMetric }) {
  const semantic = sourceSemantics(metric);
  const threat = metricThreatLevel(metric);
  return (
    <div className="storm-metric-row">
      <div>
        <strong>{metric.label}</strong>
        {metric.availability !== "available" && <small>{metric.unavailableReason ?? "Not supplied by Core"}</small>}
      </div>
      <b data-threat={threat}>{formatMetric(metric)}</b>
      {semantic !== "DIRECT" && <em data-kind={semantic}>{semantic}</em>}
    </div>
  );
}

export function StormIntelMetricBoard({ coreState }: { coreState: OpsCoreState }) {
  const snapshot = coreState.stormIntel.pointSnapshot;
  return (
    <section className="storm-workspace__metrics" aria-label="Storm Intel metric groups">
      {STORM_METRIC_GROUPS.map((group) => {
        const metrics = metricsForGroup(snapshot, group);
        return (
          <article className="storm-metric-group" key={group.id}>
            <header>
              <div>
                <span>{group.purpose}</span>
                <h3>{group.title}</h3>
              </div>
              <b>{metrics.length} SUPPLIED</b>
            </header>
            {metrics.length > 0 ? (
              <div className="storm-metric-group__rows">
                {metrics.map((metric) => <MetricRow metric={metric} key={metric.key} />)}
              </div>
            ) : (
              <p>UNAVAILABLE FROM CURRENT CORE CONTRACT</p>
            )}
          </article>
        );
      })}
    </section>
  );
}
