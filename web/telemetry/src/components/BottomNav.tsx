const navItems = ["Dashboard", "Wind", "Weather", "GPS", "System", "Settings"];

export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Telemetry navigation">
      {navItems.map((item, index) => (
        <button className={index === 0 ? "active" : ""} type="button" key={item}>
          <span className="nav-dot" aria-hidden="true" />
          {item}
        </button>
      ))}
    </nav>
  );
}
