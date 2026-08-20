# Code Black Chaser Net v0.1 Foundation

Code Black Chaser Net is a screened operational network for real storm chasers, trained spotters,
teams, and partner users. It is not an open anonymous social map, not a follower platform, and not a
replacement for official NWS warnings.

## Architecture

The v0.1 foundation lives in shared TypeScript so Android, iOS, iPadOS, and Windows clients can use
the same contracts. Android-specific Chase Tracking remains separate behind platform adapters.

Current production runtime is honest when no Chaser Net backend/auth provider is configured:

- Chaser Net status reports not configured.
- Presence sharing is off by default.
- Map layers draw no fake members or reports.
- Local Chase Tracking and Chaser Net Presence Sharing remain separate controls.

## Identity And Membership

The model separates:

- authenticated application identity
- Chaser Net member profile
- membership state
- network roles
- team membership
- verification level

Membership states:

- applicant
- probationary
- active
- suspended
- removed

Roles:

- applicant
- probationary
- verified-chaser
- verified-spotter
- team-partner
- moderator
- admin

Display name and callsign are profile fields, not authentication.

## Privacy

Location visibility modes:

- hidden
- team-only
- trusted-network
- delayed

Hidden is the default. Team-only visibility is enforced at the service/API response layer, not only
by hiding a marker in the UI. Delayed mode is modeled as a backend publication contract so future
implementation can expose delayed location truthfully instead of only changing UI timestamps.

Local device breadcrumbs are not uploaded by the Chaser Net presence switch. Future Chaser Net live
location sharing must remain explicit and independently user-controlled.

## Presence

Presence supports:

- active-chase
- observing
- repositioning
- stationary
- off-duty
- emergency

Presence freshness is classified as current, aging, stale, or offline. Live presence is current
operational state only. It does not publish full local breadcrumb history.

## Reports

Chaser Net reports are first-party human observations with provenance:

`CHASERNET/HUMAN`

They are non-official and remain distinct from NWS/NOAA warnings, radar, and future model data.

Initial report categories include tornado, funnel cloud, wall cloud, rotation/suspicious lowering,
hail, wind, wind damage, flooding, flash flooding, power flash, lightning damage, road blockage,
debris, visual confirmation, and other.

Report verification is separate from member verification. A verified chaser can still submit an
unverified report. Current states are unverified, corroborated, moderator-reviewed, retracted, and
disputed.

## Moderation And Audit

The foundation includes models for report/member flags, moderator actions, suspensions, retractions,
review/appeal state, and audit events. Moderation actions are attributable to a moderator/admin
identity, timestamp, reason, target, and action.

Audit records are intended for administrative accountability without logging unnecessary sensitive
content.

## API Contracts

Read contracts:

- `GET /chaser-net/me`
- `GET /chaser-net/members`
- `GET /chaser-net/presence`
- `GET /chaser-net/reports`
- `GET /chaser-net/teams`

Viewport-aware queries support north, south, east, west, zoom, and optional since/updated-after
semantics where useful.

Write contracts:

- `POST /chaser-net/presence`
- `POST /chaser-net/reports`
- `PATCH /chaser-net/reports/:id`
- `POST /chaser-net/reports/:id/retract`
- `PATCH /chaser-net/me/privacy`

Realtime event contract:

- `application.submitted`
- `application.reviewed`
- `presence.updated`
- `presence.offline`
- `report.created`
- `report.updated`
- `report.retracted`
- `member.updated`
- `team.updated`

Payloads are schema-versioned.

## Retention Assumptions

Current presence should be ephemeral or short-lived. Operational reports and audit/security events
may have longer retention. Precise local breadcrumb history remains a separate local/Core chase
history domain unless a future explicit sharing feature is approved.

## Deferred

Not implemented in v0.1:

- public signup
- production application/admin review UI
- payments/subscriptions
- follower counts, likes, or public social feed
- production team chat
- push-to-talk
- Spotter Network submission or data redistribution
- production mobile mesonet ingestion
- probe production ingestion
- HRRR/RAP, soundings, GOES, or GLM
- production navigation or ESCAPE routing
- CarPlay or Android Auto
- iOS packaging or Windows packaging

Recommended next pass: Chaser Net v0.2, covering screened application/admin workflow, operational
team features, and production presence deployment.

## v0.2 Application Review Foundation

The shared service layer now includes the first screened-membership workflow contracts:

- authenticated application draft save
- authenticated application submission
- code-of-conduct and experience gates before submission
- moderator-only application review queue
- moderator-only approval/rejection decisions
- probationary member creation on approval
- application-specific audit events
- backend snapshot import/export for future durable storage

Sensitive application review fields stay in `internalReview` and are not used by the map, presence,
member marker, or public/trusted profile flows. Public application UI, production auth, durable
database persistence, and admin dashboards remain deferred.

Additional read contract:

- `GET /chaser-net/applications`

Additional write contracts:

- `PATCH /chaser-net/applications/me`
- `POST /chaser-net/applications/me/submit`
- `PATCH /chaser-net/applications/:id/review`

The in-app Chaser Net panel shows these contracts as foundation-ready but continues to report the
runtime backend as not configured until a real provider is connected.
