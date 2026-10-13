import asyncio
import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

import httpx

from fastapi import FastAPI, Header, HTTPException, Query, Request, WebSocket
from pydantic import BaseModel, Field
from starlette.responses import Response, StreamingResponse

from code_black_core_api.chase_compat import resolve_legacy_chase_location
from code_black_core_api.chase_config import (
    ChaseConfigDocument,
    ChaseConfigError,
    load_chase_config,
)
from code_black_core_api.chase_ingest import (
    ChaseLocationHeartbeat,
    ChaseTimestampInvalid,
    ChaseUnitNotAuthorized,
    heartbeat_to_fabric_message,
)
from code_black_core_api.mesonet import register_mesonet
from code_black_core_api.config import load_settings
from code_black_core_api.context import ChangeTracker, ContextSnapshot, build_context_snapshot
from code_black_core_api.fabric import (
    FabricCurrentStateStore,
    FabricIngestMessage,
    FabricNormalizedState,
    FabricRadarState,
    FabricValidationError,
    emit_fabric_websocket,
)
from code_black_core_api.local_ai import (
    AiAssessmentState,
    LocalAiHealthState,
    LocalAiService,
    TargetAiAnalysisState,
    emit_local_ai_websocket,
)
from code_black_core_api.radar_ingest import RadarIngestPoller
from code_black_core_api.soundings_engine.location import LocationError, resolve_location
from code_black_core_api.soundings_engine.models import select_run
from code_black_core_api.soundings_engine.sounding_service import (
    SoundingServiceError,
    build_sounding,
)
from code_black_core_api.storm_intel import (
    SUPPORTED_AHEAD_OF_UNIT_DISTANCES_MILES,
    StormIntelHealth,
    StormIntelService,
    StormIntelSnapshot,
    build_provider_from_settings,
    emit_storm_intel_websocket,
)
from code_black_core_api.storm_intel.models import DEFAULT_AHEAD_OF_UNIT_DISTANCE_MILES, ContextType
from code_black_core_api.telemetry import (
    InMemoryTelemetryStore,
    TelemetrySnapshot,
    TelemetrySourceInventory,
)
from code_black_core_api.weather import (
    AlertsResponse,
    CurrentConditions,
    NwsWeatherProvider,
    StationsResponse,
    WeatherProvider,
    WeatherServiceError,
    unavailable_weather_provider_response,
)
from code_black_core_api.weather_alert_control import WeatherAlertControlError, request_settings, request_status
from code_black_core_api.gpu_control import GpuControlError, request_gpu_control
from code_black_core_api.diagnostics import IncidentInput, IncidentLedger
from code_black_core_api.aegis_observation import build_observation_plan
from code_black_core_api.aegis_console import AegisConsoleRelay

# Extensible allowlist for the /api/soundings/v1 contract -- HRRR is the only model the
# vendored engine actually acquires data for today. Adding RAP/RRFS later means adding a real
# acquisition path in soundings_engine/models.py first, then adding it here -- never claiming
# support for a model this service cannot actually fetch.
SOUNDINGS_SUPPORTED_MODELS = frozenset({"HRRR"})


class TargetAnalysisRequest(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


def create_app(
    telemetry_store: InMemoryTelemetryStore | None = None,
    weather_provider: WeatherProvider | None = None,
    fabric_store: FabricCurrentStateStore | None = None,
    storm_intel_service: StormIntelService | None = None,
    radar_ingest_poller: RadarIngestPoller | None = None,
    local_ai_service: LocalAiService | None = None,
) -> FastAPI:
    settings = load_settings()
    incidents = IncidentLedger(settings.diagnostics_file)
    telemetry = telemetry_store or InMemoryTelemetryStore()
    weather = weather_provider or NwsWeatherProvider(user_agent=settings.weather_user_agent)
    fabric = fabric_store or FabricCurrentStateStore()
    radar_poller = radar_ingest_poller or RadarIngestPoller(
        fabric,
        base_url=settings.radar_worker_base_url,
        poll_seconds=settings.radar_poll_seconds,
        default_unit_id=settings.radar_default_unit_id,
    )
    storm_intel = storm_intel_service or StormIntelService(
        build_provider_from_settings(
            settings.storm_intel_provider,
            settings.storm_intel_simulation_scenario,
            grib_cache_dir=settings.storm_intel_grib_cache_dir,
            grib_cache_max_bytes=settings.storm_intel_grib_cache_max_bytes,
            grib_cache_max_age_seconds=settings.storm_intel_grib_cache_max_age_seconds,
            grib_timeout_seconds=settings.storm_intel_grib_timeout_seconds,
            grib_max_retries=settings.storm_intel_grib_max_retries,
            grib_lookback_hours=settings.storm_intel_grib_lookback_hours,
        ),
        fabric,
    )
    local_ai = local_ai_service or LocalAiService(
        fabric,
        storm_intel,
        base_url=settings.phaenon3_base_url,
        token=settings.phaenon3_token,
        default_unit_id=settings.local_ai_default_unit_id,
        model=settings.phaenon3_model,
        min_interval_seconds=settings.local_ai_min_interval_seconds,
        poll_seconds=settings.local_ai_poll_seconds,
        valid_for_seconds=settings.local_ai_valid_for_seconds,
        http_timeout_seconds=settings.local_ai_http_timeout_seconds,
    )
    context_tracker = ChangeTracker()
    aegis_console = AegisConsoleRelay(settings.aegis_console_base_url)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        # Phase 4A.2: the only resource in this app with an explicit
        # shutdown need today is Storm Intel's dedicated provider thread
        # pool (see `StormIntelService.close()`) -- releasing it here
        # avoids leaking non-daemon worker threads past process shutdown.
        # Deliberately scoped to just this one resource, not a general
        # app-wide lifecycle redesign: neither the weather provider's nor
        # the live NOAA provider's own `httpx.Client` has a shutdown path
        # today either, and adding one for those is out of scope here.
        # Radar state must stay live independent of whether any client is connected (RADAR STATE
        # DISTRIBUTION AUTHORITY = FABRIC) -- a single backend-owned background task, started
        # once at process startup and stopped cleanly on shutdown alongside Storm Intel's own
        # resource above. Never starts during a TestClient used without a `with` block, since
        # Starlette only runs lifespan when it's actually entered.
        radar_poller.start()
        # Local AI is strictly advisory and never authoritative (see local_ai/models.py) -- but
        # like radar, its background poller must run independent of client connections so a
        # reconnecting client sees current state immediately rather than waiting on a fresh
        # inference (integration brief section 7).
        local_ai.start()
        try:
            yield
        finally:
            storm_intel.close()
            await radar_poller.stop()
            await local_ai.stop()

    app = FastAPI(title="Code Black Core API", version="0.1.0", lifespan=lifespan)
    register_mesonet(app, fabric)

    @app.middleware("http")
    async def attach_trace_id(request: Request, call_next):  # type: ignore[no-untyped-def]
        # OPS supplies this header when a browser request crosses its gateway.  We accept only
        # a short opaque identifier and never log query strings or request bodies.
        supplied = request.headers.get("X-CodeBlack-Trace-Id", "")
        trace_id = supplied[:96] if supplied.replace("-", "").replace("_", "").isalnum() else ""
        if not trace_id:
            import uuid
            trace_id = f"core-{uuid.uuid4().hex[:16]}"
        response = await call_next(request)
        response.headers["X-CodeBlack-Trace-Id"] = trace_id
        if response.status_code >= 500 and not request.url.path.startswith("/api/ops/v1/incidents"):
            incidents.append(IncidentInput(
                source="CORE", severity="ERROR", subsystem="CORE", action=request.method,
                result=f"HTTP_{response.status_code}", trace_id=trace_id,
                message=request.url.path,
            ))
        return response
    logger = logging.getLogger("code_black_core_api.fabric")

    @app.get("/health", tags=["health"])
    def health() -> dict[str, str]:
        return {
            "status": "healthy",
            "service": "core-api",
            "environment": settings.environment,
        }

    @app.get("/telemetry/latest", tags=["telemetry"])
    def telemetry_latest() -> TelemetrySnapshot:
        return telemetry.latest()

    @app.get("/telemetry/sources", tags=["telemetry"])
    def telemetry_sources() -> TelemetrySourceInventory:
        return telemetry.source_inventory()

    @app.post("/api/fabric/v1/ingest", tags=["fabric"])
    def fabric_ingest(message: FabricIngestMessage) -> dict[str, object]:
        try:
            events = fabric.ingest(message)
        except FabricValidationError as error:
            logger.warning("fabric ingest rejected", extra={"detail": str(error)})
            raise HTTPException(status_code=422, detail=str(error)) from error
        return {
            "accepted": True,
            "schema_version": "1.0.0",
            "event_count": len(events),
            "unit_id": message.unit_id,
            "device_id": message.device_id,
        }

    @app.get("/api/fabric/v1/units", tags=["fabric"])
    def fabric_units() -> FabricNormalizedState:
        return fabric.snapshot()

    @app.get("/api/fabric/v1/stream", tags=["fabric"])
    async def fabric_stream() -> StreamingResponse:
        """Bounded NDJSON snapshots; reconnecting rechecks gateway authorization."""

        async def frames() -> AsyncIterator[str]:
            for index in range(23):
                snapshot = fabric.snapshot()
                event = {
                    "event_type": "fabric.snapshot",
                    "timestamp": snapshot.generated_at.isoformat(),
                    "payload": snapshot.model_dump(mode="json", by_alias=True),
                }
                yield json.dumps(event, separators=(",", ":")) + "\n"
                if index < 22:
                    await asyncio.sleep(2)

        return StreamingResponse(
            frames(),
            media_type="application/x-ndjson",
            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
        )

    @app.get("/api/fabric/v1/units/{unit_id}", tags=["fabric"])
    def fabric_unit(unit_id: str) -> dict[str, object]:
        try:
            return fabric.unit(unit_id).model_dump(mode="json")
        except FabricValidationError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error

    @app.get("/api/fabric/v1/devices", tags=["fabric"])
    def fabric_devices() -> dict[str, object]:
        return {
            "schema": "codeblack.fabric.devices",
            "schema_version": "1.0.0",
            "devices": [device.model_dump(mode="json") for device in fabric.devices()],
        }

    @app.get("/api/fabric/v1/devices/{device_id}", tags=["fabric"])
    def fabric_device(device_id: str) -> dict[str, object]:
        try:
            return fabric.device(device_id).model_dump(mode="json")
        except FabricValidationError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error

    @app.get("/api/fabric/v1/health", tags=["fabric"])
    def fabric_health() -> dict[str, object]:
        snapshot = fabric.snapshot()
        return {
            "schema": "codeblack.fabric.health",
            "schema_version": "1.0.0",
            "status": "healthy",
            "unit_count": len(snapshot.units),
            "units": [
                {
                    "unit_id": unit.unit_id,
                    "overall_health": unit.overall_health,
                    "last_seen": unit.last_seen,
                }
                for unit in snapshot.units
            ],
        }

    # Keep the independent shadow-only radar feed reachable after Core API
    # consolidations. These routes only proxy the bounded loopback Aegis feed;
    # policy draft writes and activation are deliberately not exposed.
    @app.get("/api/fabric/v1/aegis-status", tags=["fabric"])
    async def aegis_status() -> dict[str, object]:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                response = await client.get("http://127.0.0.1:8789/api/fabric/v1/aegis-status")
                response.raise_for_status()
                return response.json()
        except (httpx.HTTPError, ValueError) as error:
            raise HTTPException(status_code=503, detail="Aegis feed unavailable") from error

    @app.get("/api/fabric/v1/aegis-alerts", tags=["fabric"])
    async def aegis_alerts(after: int = Query(default=0, ge=0),
                           limit: int = Query(default=100, ge=1, le=200)) -> dict[str, object]:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                response = await client.get("http://127.0.0.1:8789/api/fabric/v1/aegis-alerts",
                                            params={"after": after, "limit": limit})
                response.raise_for_status()
                return response.json()
        except (httpx.HTTPError, ValueError) as error:
            raise HTTPException(status_code=503, detail="Aegis feed unavailable") from error

    @app.get("/api/fabric/v1/aegis-policy", tags=["fabric"])
    async def aegis_policy() -> dict[str, object]:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                response = await client.get("http://127.0.0.1:8789/api/fabric/v1/aegis-policy")
                response.raise_for_status()
                return response.json()
        except (httpx.HTTPError, ValueError) as error:
            raise HTTPException(status_code=503, detail="Aegis policy unavailable") from error

    @app.post("/api/fabric/v1/aegis-policy/replay", tags=["fabric"])
    async def aegis_policy_replay(payload: dict[str, object]) -> dict[str, object]:
        if len(json.dumps(payload).encode("utf-8")) > 4096:
            raise HTTPException(status_code=413, detail="Replay input too large")
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.post("http://127.0.0.1:8789/api/fabric/v1/aegis-policy/replay",
                                             json=payload)
                if response.status_code != 200:
                    raise HTTPException(status_code=response.status_code, detail="Invalid replay input")
                return response.json()
        except (httpx.HTTPError, ValueError) as error:
            raise HTTPException(status_code=503, detail="Aegis replay unavailable") from error

    @app.get("/api/fabric/v1/radar", tags=["fabric"])
    def fabric_radar() -> FabricRadarState | dict[str, object]:
        """REST bootstrap for radar state -- covers startup before the WS has connected, and any
        client that doesn't want a live socket. Same data the WS's `fabric.snapshot`/
        `radar.updated` events carry, at `snapshot.radar`."""
        snapshot = fabric.radar_snapshot()
        if snapshot is None:
            return {
                "schema": "codeblack.fabric.radar-state",
                "schema_version": "1.0.0",
                "available": False,
                "detail": "Radar ingest has not produced a state yet",
            }
        return snapshot

    @app.get("/api/fabric/v1/aegis-observation-plan", tags=["aegis-observation"])
    def aegis_observation_plan() -> dict[str, object]:
        """Read-only evidence plan for OPS; it cannot route, warn, or command a vehicle."""
        fabric_state = fabric.snapshot().model_dump(mode="json")
        radar_state = fabric.radar_snapshot()
        radar = radar_state.model_dump(mode="json") if radar_state is not None else None
        return build_observation_plan(fabric_state, radar)

    @app.api_route(
        "/api/ops/v1/aegis-console", methods=["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"],
        tags=["ops"],
    )
    @app.api_route(
        "/api/ops/v1/aegis-console/{resource_path:path}", methods=["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"],
        tags=["ops"],
    )
    async def aegis_console_proxy(request: Request, resource_path: str = "") -> Response:
        """Relay the fixed private AEGIS console for the authenticated OPS bridge.

        This route is reached only through the existing Core gateway; it never accepts an
        upstream hostname from the browser and leaves AEGIS's own Supabase session check intact.
        """
        return await aegis_console.forward(
            resource_path=resource_path,
            method=request.method,
            query=request.url.query,
            headers=request.headers,
            body=await request.body(),
        )

    @app.websocket("/api/fabric/v1/ws")
    async def fabric_ws(websocket: WebSocket) -> None:
        await emit_fabric_websocket(websocket, fabric)

    @app.get("/api/ai/v1/health", tags=["local-ai"])
    def local_ai_health() -> LocalAiHealthState:
        return local_ai.health()

    @app.get("/api/ai/v1/assessment", tags=["local-ai"])
    def local_ai_assessment() -> AiAssessmentState:
        """REST bootstrap for the current Local AI advisory state -- same data the WS's initial
        send and `ai.assessment_updated` events carry. Strictly advisory; see local_ai/models.py.
        """
        return local_ai.current()

    @app.post("/api/ai/v1/assessment/refresh", tags=["local-ai"])
    async def local_ai_assessment_refresh() -> AiAssessmentState:
        """Explicit user/test request trigger (integration brief section 5) -- still bound by
        the same cooldown every other trigger obeys; this cannot be used to bypass debouncing."""
        return await local_ai.request_now()

    @app.post("/api/ai/v1/target-analysis", tags=["local-ai"])
    async def local_ai_target_analysis(request: TargetAnalysisRequest) -> TargetAiAnalysisState:
        """Generate a guarded advisory for an explicitly selected target point.

        The response includes the deterministic radar-worker evidence used by the model; it is
        advisory only and never arms a target or issues a weather alert.
        """
        return await local_ai.analyze_target(request.latitude, request.longitude)

    @app.websocket("/api/ai/v1/ws")
    async def local_ai_ws(websocket: WebSocket) -> None:
        await emit_local_ai_websocket(websocket, local_ai)

    def require_context_token(authorization: str | None) -> None:
        # Defense in depth on top of Tailscale network trust -- see
        # docs/system/code-black-context-gateway.md. Empty token = feature not configured, not
        # "auth disabled"; every request is rejected until a real token is set, exactly like
        # PHAENON3's weather-worker token (worker.py) and local_ai's own PHAENON3 client.
        expected = settings.context_gateway_token
        supplied = (
            authorization.removeprefix("Bearer ").strip()
            if authorization and authorization.startswith("Bearer ")
            else ""
        )
        if not expected or supplied != expected:
            raise HTTPException(status_code=401, detail="Invalid context gateway credentials")

    @app.get("/api/context/v1/snapshot", tags=["context"])
    def context_snapshot(authorization: str | None = Header(default=None)) -> ContextSnapshot:
        """Read-only, normalized aggregation of Fabric/Storm Intel/Local AI/telemetry state --
        see context.py module docstring. GET only; this route (and this module) has no write
        path of any kind. The only Core route this feature exposes beyond Core's loopback
        interface -- see docs/system/code-black-context-gateway.md for the Tailscale-serve
        publication boundary (this path only, nothing else on this app)."""
        require_context_token(authorization)
        # The observation planner is read-only and its output is reduced to a bounded evidence
        # section by the context gateway.  If its optional local inputs fail, chat still receives
        # the rest of Core's live context with an explicit unavailable AEGIS section.
        try:
            context_now = datetime.now(UTC)
            fabric_snapshot = fabric.snapshot(now=context_now)
            radar_snapshot = fabric.radar_snapshot(now=context_now)
            observation = build_observation_plan(
                fabric_snapshot.model_dump(mode="json"),
                radar_snapshot.model_dump(mode="json") if radar_snapshot else None,
            )
        except Exception:  # noqa: BLE001 - optional read-only context source
            logger.exception("AEGIS observation plan unavailable for context snapshot")
            observation = None
        return build_context_snapshot(
            fabric, storm_intel, local_ai, telemetry, context_tracker,
            aegis_observation=observation,
        )

    def require_chase_config_token(authorization: str | None) -> None:
        """Pre-auth uses the Tailscale serve boundary; this enables bearer auth next."""
        expected = settings.chase_config_token
        if not expected:
            return
        supplied = (
            authorization.removeprefix("Bearer ").strip()
            if authorization and authorization.startswith("Bearer ")
            else ""
        )
        if supplied != expected:
            raise HTTPException(status_code=401, detail="Invalid Chase config credentials")

    @app.get("/api/chase/v1/config", tags=["chase-config"])
    def chase_config(authorization: str | None = Header(default=None)) -> ChaseConfigDocument:
        """Private, versioned Chase configuration. It has no write path."""
        require_chase_config_token(authorization)
        try:
            return load_chase_config(settings.chase_config_file)
        except ChaseConfigError as error:
            logger.error("Chase config unavailable", extra={"detail": str(error)})
            raise HTTPException(
                status_code=503, detail="Chase configuration unavailable"
            ) from error

    @app.get("/api/weather-alert/v1/settings", tags=["weather-alert-controls"])
    def weather_alert_settings() -> dict[str, object]:
        try:
            return request_settings(settings.weather_alert_control_url)
        except WeatherAlertControlError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    @app.put("/api/weather-alert/v1/settings", tags=["weather-alert-controls"])
    def replace_weather_alert_settings(document: dict[str, object]) -> dict[str, object]:
        try:
            return request_settings(
                settings.weather_alert_control_url, method="PUT", payload=document
            )
        except WeatherAlertControlError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    @app.get("/api/weather-alert/v1/status", tags=["weather-alert-controls"])
    def weather_alert_status() -> dict[str, object]:
        try:
            return request_status(settings.weather_alert_control_url)
        except WeatherAlertControlError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    @app.get("/api/gpu/v1/status", tags=["gpu-controls"])
    def gpu_operations_status() -> dict[str, object]:
        try:
            return request_gpu_control(settings.gpu_control_url, settings.gpu_control_token)
        except GpuControlError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    @app.post("/api/gpu/v1/mode", tags=["gpu-controls"])
    def set_gpu_operations_mode(document: dict[str, object]) -> dict[str, object]:
        mode = document.get("mode")
        if mode not in {"BALANCED", "ANALYSIS", "PASSIVE_LEARNING", "MEDIA", "LIVE_AGENT"}:
            raise HTTPException(status_code=422, detail="Invalid GPU operations mode")
        try:
            return request_gpu_control(
                settings.gpu_control_url, settings.gpu_control_token, method="POST", payload={"mode": mode}
            )
        except GpuControlError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    @app.get("/api/ops/v1/incidents", tags=["ops-diagnostics"])
    def recent_ops_incidents(
        limit: int = Query(default=100, ge=1, le=200),
        severity: str | None = Query(default=None),
        subsystem: str | None = Query(default=None),
    ) -> dict[str, object]:
        allowed = {"INFO", "WARN", "ERROR"}
        if severity is not None and severity not in allowed:
            raise HTTPException(status_code=422, detail="Invalid incident severity")
        return {
            "schema": "codeblack.ops.incidents.v1",
            "retention": "500 structured events; request bodies, credentials, and precise coordinates are never retained",
            "events": incidents.recent(limit=limit, severity=severity, subsystem=subsystem),
        }

    @app.post("/api/ops/v1/incidents", tags=["ops-diagnostics"])
    def record_ops_incident(
        incident: IncidentInput,
        x_codeblack_trace_id: str | None = Header(default=None),
    ) -> dict[str, object]:
        # Only structured fields accepted by IncidentInput are persisted.  This is purposely
        # not a generic client log upload endpoint.
        return {"incident": incidents.append(incident, trace_id=x_codeblack_trace_id)}

    @app.post("/api/ops/v1/incidents/verify", tags=["ops-diagnostics"])
    def verify_ops_incident(document: dict[str, str]) -> dict[str, object]:
        incident_id = document.get("incident_id", "")
        if not incident_id.startswith("inc-") or len(incident_id) > 32:
            raise HTTPException(status_code=422, detail="Invalid incident id")
        event = incidents.verify(incident_id, document.get("note"))
        if event is None:
            raise HTTPException(status_code=404, detail="Incident not found")
        return {"incident": event}

    def require_chase_token(authorization: str | None) -> None:
        # Reused, unchanged, from the historical chase-location auth contract -- the legacy
        # codeblack-chase-gateway Worker already sends this header when calling Core. Fabric
        # itself is never gated by this token; it protects only this compatibility route.
        expected = settings.chase_location_token
        supplied = (
            authorization.removeprefix("Bearer ").strip()
            if authorization and authorization.startswith("Bearer ")
            else ""
        )
        if not expected or supplied != expected:
            raise HTTPException(status_code=401, detail="Invalid chase location credentials")

    @app.post("/api/chase/location", tags=["chase-location-compat"])
    def chase_location_ingest_compat(
        heartbeat: ChaseLocationHeartbeat,
        authorization: str | None = Header(default=None),
        x_codeblack_chase_source: str | None = Header(default=None),
    ) -> dict[str, object]:
        # Thin write adapter for the already-deployed Chase V2 Android app -- see
        # chase_ingest.py. No ChaseLocationStore, no independent state. unit_id is validated
        # (never trusted) against the one authorized unit; device_id is never client-supplied.
        require_chase_token(authorization)
        try:
            message = heartbeat_to_fabric_message(heartbeat)
        except ChaseUnitNotAuthorized as error:
            raise HTTPException(
                status_code=403, detail="Unit not authorized for this route"
            ) from error
        except ChaseTimestampInvalid as error:
            raise HTTPException(status_code=422, detail="Invalid timestamp") from error
        try:
            fabric.ingest(message)
        except FabricValidationError as error:
            logger.warning("chase-v2 ingest rejected by fabric", extra={"detail": str(error)})
            raise HTTPException(status_code=422, detail=str(error)) from error
        if x_codeblack_chase_source == "public-v1":
            # The gateway-only marker makes pre-auth public Chase delivery observable without
            # accepting a client-controlled source identity or changing Fabric's contract.
            logger.warning("Chase public telemetry accepted")
        return {"accepted": True, "unit_id": heartbeat.unit_id}

    @app.get("/api/chase/location/latest", tags=["chase-location-compat"])
    def chase_location_latest_compat(
        unit_id: str = Query(min_length=1, max_length=80),
        authorization: str | None = Header(default=None),
    ) -> dict[str, object]:
        # Fabric-backed compatibility facade only -- see chase_compat.py. No ChaseLocationStore,
        # no ingest, no mutation of Fabric. Restores the legacy response shape the
        # codeblack-chase-gateway Worker already expects from this route.
        require_chase_token(authorization)
        return resolve_legacy_chase_location(fabric, unit_id)

    @app.get("/weather/alerts", tags=["weather"])
    def weather_alerts(
        latitude: float = Query(ge=-90, le=90),
        longitude: float = Query(ge=-180, le=180),
    ) -> AlertsResponse | dict[str, str]:
        try:
            return weather.alerts_near_location(latitude, longitude)
        except WeatherServiceError as error:
            return unavailable_weather_provider_response(error)

    @app.get("/weather/conditions", tags=["weather"])
    def weather_conditions(
        latitude: float = Query(ge=-90, le=90),
        longitude: float = Query(ge=-180, le=180),
    ) -> CurrentConditions | dict[str, str]:
        try:
            return weather.current_conditions(latitude, longitude)
        except WeatherServiceError as error:
            return unavailable_weather_provider_response(error)

    @app.get("/weather/stations", tags=["weather"])
    def weather_stations(
        latitude: float = Query(ge=-90, le=90),
        longitude: float = Query(ge=-180, le=180),
        count: int = Query(default=3, ge=1, le=10),
    ) -> StationsResponse | dict[str, str]:
        try:
            return weather.nearby_stations(latitude, longitude, count)
        except WeatherServiceError as error:
            return unavailable_weather_provider_response(error)

    @app.get("/api/storm-intel/v1/health", tags=["storm-intel"])
    def storm_intel_health() -> StormIntelHealth:
        return storm_intel.health()

    @app.get("/api/storm-intel/v1/contexts/unit/{unit_id}", tags=["storm-intel"])
    def storm_intel_at_unit(unit_id: str) -> StormIntelSnapshot:
        if unit_id not in fabric.registry.units:
            raise HTTPException(status_code=404, detail=f"Unknown unit_id: {unit_id}")
        return storm_intel.snapshot_for_unit(unit_id)

    @app.get("/api/storm-intel/v1/contexts/unit/{unit_id}/ahead", tags=["storm-intel"])
    def storm_intel_ahead_of_unit(
        unit_id: str,
        distance_miles: int = Query(default=DEFAULT_AHEAD_OF_UNIT_DISTANCE_MILES),
    ) -> StormIntelSnapshot:
        if unit_id not in fabric.registry.units:
            raise HTTPException(status_code=404, detail=f"Unknown unit_id: {unit_id}")
        if distance_miles not in SUPPORTED_AHEAD_OF_UNIT_DISTANCES_MILES:
            raise HTTPException(
                status_code=422,
                detail=(f"distance_miles must be one of {SUPPORTED_AHEAD_OF_UNIT_DISTANCES_MILES}"),
            )
        return storm_intel.snapshot_ahead_of_unit(unit_id, distance_miles=float(distance_miles))

    @app.get("/api/storm-intel/v1/point", tags=["storm-intel"])
    def storm_intel_point(
        latitude: float = Query(ge=-90, le=90),
        longitude: float = Query(ge=-180, le=180),
    ) -> StormIntelSnapshot:
        return storm_intel.snapshot_for_point(latitude, longitude)

    @app.websocket("/api/storm-intel/v1/ws")
    async def storm_intel_ws(
        websocket: WebSocket,
        unit_id: str | None = None,
        distance_miles: float | None = None,
        latitude: float | None = None,
        longitude: float | None = None,
        poll_seconds: float = Query(default=30.0, ge=1.0, le=300.0),
    ) -> None:
        context_type: ContextType
        if latitude is not None and longitude is not None:
            context_type = "SELECTED_TARGET"
        elif unit_id is not None and distance_miles is not None:
            context_type = "AHEAD_OF_UNIT"
        elif unit_id is not None:
            context_type = "AT_UNIT"
        else:
            await websocket.close(code=1008)
            return
        await emit_storm_intel_websocket(
            websocket,
            storm_intel,
            context_type=context_type,
            unit_id=unit_id,
            distance_miles=distance_miles,
            latitude=latitude,
            longitude=longitude,
            poll_seconds=poll_seconds,
        )

    @app.get("/api/soundings/v1/health", tags=["soundings"])
    def soundings_health() -> dict[str, object]:
        return {
            "schema": "codeblack.soundings.health",
            "schema_version": "1.0.0",
            "status": "healthy",
            "supported_models": sorted(SOUNDINGS_SUPPORTED_MODELS),
        }

    @app.get("/api/soundings/v1/point", tags=["soundings"])
    async def soundings_point(
        latitude: float = Query(ge=-90, le=90),
        longitude: float = Query(ge=-180, le=180),
        model: str = Query(default="HRRR"),
        location_name: str | None = Query(default=None),
    ) -> dict[str, object]:
        model_upper = model.upper()
        if model_upper not in SOUNDINGS_SUPPORTED_MODELS:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Unsupported model '{model}'. Supported: {sorted(SOUNDINGS_SUPPORTED_MODELS)}."
                ),
            )
        run = select_run(model_upper, datetime.now(UTC), None)
        try:
            result = await build_sounding(run, latitude, longitude, location_name=location_name)
        except SoundingServiceError as error:
            raise HTTPException(status_code=502, detail=str(error)) from error
        return result.to_dict()

    @app.get("/api/soundings/v1/search-location", tags=["soundings"])
    async def soundings_search_location(city: str, state: str) -> dict[str, object]:
        try:
            loc = await resolve_location(city, state)
        except LocationError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        return {
            "query_city": loc.query_city,
            "query_state": loc.query_state,
            "display_name": loc.display_name,
            "latitude": loc.latitude,
            "longitude": loc.longitude,
            "source": loc.source,
        }

    return app


app = create_app()
