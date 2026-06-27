import { NavLink } from "react-router-dom";

const NAV = [
  { to: "/",        label: "DASHBOARD" },
  { to: "/wind",    label: "WIND"      },
  { to: "/weather", label: "WEATHER"   },
  { to: "/gps",     label: "GPS"       },
  { to: "/system",  label: "SYSTEM"    },
  { to: "/settings",label: "SETTINGS"  },
];

export function BottomNav() {
  return (
    <nav className="flex items-stretch h-10 bg-cb-panel border-t border-cb-border shrink-0">
      {NAV.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          className={({ isActive }) =>
            `flex-1 flex items-center justify-center font-mono text-[10px] uppercase tracking-widest transition-colors
             ${isActive
               ? "text-cb-blue border-t-2 border-cb-blue bg-cb-blue/5"
               : "text-cb-muted border-t-2 border-transparent hover:text-cb-secondary"
             }`
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
