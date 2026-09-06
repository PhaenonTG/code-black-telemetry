export function TimelineRail() {
  const hours = ["NOW", "+1H", "+2H", "+3H", "+6H", "+12H"];
  return (
    <div className="ops-timeline" aria-label="Forecast timeline">
      <div>
        <span>VALID TIME</span>
        <b>Architecture Ready</b>
      </div>
      <div className="ops-timeline__ticks">
        {hours.map((hour, index) => (
          <button key={hour} type="button" className={index === 0 ? "active" : ""}>
            {hour}
          </button>
        ))}
      </div>
    </div>
  );
}
