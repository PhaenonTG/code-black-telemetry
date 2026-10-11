# OPS automation foundation

The Automation Lab at `/automation-lab` is the first operator-facing design and
test surface for Code Black workflows. It is intentionally **read-only**:
changing a draft or running a test never changes Core, Fabric, Edge, Discord,
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

The lab simulates **step 4 only** with hypothetical inputs. Its `WOULD_ROUTE`
result means the draft policy's downstream gates pass, not that a live radar
candidate exists or that any real message was sent. The live status strip reads
Core but cannot edit its configuration.

## Next contracts before operator-controlled automation

- Add a versioned policy record on Core: immutable policy revision, validated
  threshold, delivery gate, actor, creation time, and rollback revision.
- Add an authenticated, allowlisted `POST /dry-run` that invokes the same Core
  dispatch policy as production against recorded fixtures and returns a trace.
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
