# OPS automation foundation

The Automation Lab at `/automation-lab` is the first operator-facing design and
test surface for Code Black workflows. It is intentionally **non-activating**:
changing a scenario or running a replay never changes Core's live configuration, Fabric, Edge, Discord,
or an official NWS warning. It uses the existing Core and Edge machines; no
additional cloud computer is required. OPS hosting and its authenticated Core
gateway remain on the existing Cloudflare setup.

## First workflow: warning-triggered Aegis screen

1. The existing official-warning bot delivers NWS warnings independently.
2. Core's Aegis worker discovers active Tornado and Severe Thunderstorm Warning
   polygons, selects a nearby WSR-88D, and records completed Level II scans.
3. A radar candidate must satisfy the worker's spatial, temporal, product,
   freshness, and evidence-score gates. The score is not a calibrated tornado
   probability; a CC drop does not by itself establish a TDS.
4. The Core-local `delivery_enabled` gate controls publication to the durable
   Fabric Aegis feed. OPS polls the feed; Edge's weather-alerts Discord
   subscriber independently checks schema, cutoff, and freshness.
5. Each event has a stable ID and sequence so delivery can replay without
   posting duplicate candidates.

The lab asks Core to dry-run **step 4 only** with hypothetical inputs. Its `WOULD_ROUTE`
result means the draft policy's downstream gates pass, not that a live radar
candidate exists or that any real message was sent. The live status strip reads
Core but cannot edit its configuration. It can also replay the last ten saved
scan-screening records at a selected cutoff. That replay never refetches historical
warning polygons or establishes tornado ground truth; scans with no captured
candidates correctly report zero. Both Core responses assert `dry_run`,
`no_messages_sent`, and `no_config_changed`.

Core keeps an append-only, Core-local policy draft journal with baseline, draft,
and rollback revisions. The journal is **not** wired to the live scanner; its
local operator actor label is not cryptographic identity. The OPS gateway exposes
only authenticated GET policy state and bounded POST replay. It does not expose
draft writes, rollback, or activation. Live delivery remains off until labeled
score calibration and operator-controlled activation are built and reviewed.

## Next contracts before operator-controlled automation

- Harden the local draft journal with verified operator identity, locking for
  concurrent writers, and retention/rotation before making edits web-accessible.
- Add a durable event/job ledger and labeled calibration corpus; recorded
  screening replay alone is not retrospective ground truth.
- Separate "save draft", "request activation", and "activate" operations.
  Activation must require operator identity, explicit confirmation, an audit
  entry, and a rollback path. No generic command execution.
- Add a durable job/event ledger with warning ID, radar volume key, candidate
  ID, policy revision, action attempts, subscriber acknowledgements, and
  dead-letter status. Bound retries and message frequency.
- Replay labeled tornadic and non-tornadic cases to calibrate the threshold;
  keep the real delivery gate off until false-positive and missed-case review.
- Support more concurrent warned storms only after measuring Core load, data
  lag, and radar-site coverage. The current two-site canary is not nationwide.
- Expose scan latency, missing moments, radar limitations, and delivery health
  in Status Center. Keep official warning delivery independent of Aegis.

Safety invariant: no OPS draft, test, model narrative, or Aegis candidate may
delay, suppress, or masquerade as an official NWS warning.
