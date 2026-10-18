import { fetchForecast } from "../../core/client"
import { requestDeadline } from "../../core/requestDeadline"
import type { OpsCoreConfig } from "../../core/config"
import type { Catalog } from "./HorizonCatalog"
export async function loadHorizonCatalog(config: OpsCoreConfig, signal?: AbortSignal): Promise<Catalog> {
 const value = await requestDeadline(inner => fetchForecast<Catalog>(config, "chase-horizons", inner), 10_000, signal)
 if(value.schema!=="codeblack.chase.horizon-catalog.v1"||!Array.isArray(value.records)||value.records.length>1600||!Array.isArray(value.sources)||value.sources.length>14||!Array.isArray(value.history)) throw Error("Invalid catalog")
 return value
}
