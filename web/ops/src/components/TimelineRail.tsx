export function TimelineRail() {
  const hours = ["NOW", "+1H", "+2H", "+3H", "+6H", "+12H"];
  return (
    <div className="ops-timeline" aria-label="Forecast timeline">
      <div>
        <span>VALID TIME</span>
        <b>Current only</b>
        <em>Future valid-time selection awaits Core contract support</em>
      </div>
      <div className="ops-timeline__ticks">
        {hours.map((hour, index) => (
          <button
            key={hour}
            type="button"
            className={index === 0 ? "active" : ""}
            disabled={index !== 0}
            title={index === 0 ? undefined : "Future valid-time selection awaits Core contract support"}
          >
            {hour}
          </button>
        ))}
      </div>
    </div>
  );
}
