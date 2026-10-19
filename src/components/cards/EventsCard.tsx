import { memo } from "react";
import { useEvents } from "../../hooks/useTelemetry";
import { DashCard } from "../ui/DashCard";

const levelColor: Record<string, string> = {
  info:  "text-cb-secondary",
  warn:  "text-cb-amber",
  error: "text-cb-red",
};

const levelTag: Record<string, string> = {
  info:  "INFO",
  warn:  "WARN",
  error: "ERR",
};

export const EventsCard = memo(function EventsCard({ className }: { className?: string }) {
  const events = useEvents();
  if (!events) return null;

  return (
    <DashCard title="Recent Events" className={className}>
      <div className="cb-scroll flex flex-col gap-1 max-h-36">
        {events.length === 0 && <div className="calm-card">NO RECENT EVENTS</div>}
        {events.slice(0, 8).map(ev => {
          const t = new Date(ev.timestamp);
          const ts = `${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}:${String(t.getSeconds()).padStart(2,"0")}`;
          return (
            <div key={ev.id} className="flex items-baseline gap-2 font-mono text-[11px]">
              <span className="text-cb-muted tabular-nums shrink-0">{ts}</span>
              <span className={`shrink-0 ${levelColor[ev.level]}`}>[{levelTag[ev.level].padEnd(4)}]</span>
              <span className="text-cb-secondary">{ev.message}</span>
            </div>
          );
        })}
      </div>
    </DashCard>
  );
});
