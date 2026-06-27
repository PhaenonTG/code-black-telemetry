import { WindCard }         from "../components/cards/WindCard";
import { WeatherCard }      from "../components/cards/WeatherCard";
import { GpsCard }          from "../components/cards/GpsCard";
import { SensorHealthCard } from "../components/cards/SensorHealthCard";
import { PowerCard }        from "../components/cards/PowerCard";
import { SystemCard }       from "../components/cards/SystemCard";
import { EventsCard }       from "../components/cards/EventsCard";

export function Dashboard() {
  return (
    <div className="cb-scroll flex-1 p-3 grid gap-3" style={{
      gridTemplateColumns: "repeat(4, 1fr)",
      gridTemplateRows: "auto auto auto",
      alignContent: "start",
    }}>
      {/* Primary row */}
      <WindCard    className="col-span-1" />
      <WeatherCard className="col-span-1" />
      <GpsCard     className="col-span-1" />
      <EventsCard  className="col-span-1" />

      {/* Lower row */}
      <SensorHealthCard className="col-span-1" />
      <PowerCard        className="col-span-1" />
      <SystemCard       className="col-span-1" />
    </div>
  );
}
