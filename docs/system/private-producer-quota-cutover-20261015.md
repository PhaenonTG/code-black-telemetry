# Private Producer quota cutover — candidate, not activated

The owner selected zero new recurring cost and confirmed the target is
https://ops-private.codeblackwx.com. Do not enable paid Workers or Stream.

## Cause and selected fix

The existing bridge sends status, capabilities and command polling every two
seconds: 129,600 HTTP requests/day before JPEG or HLS. Free Workers allows
100,000 requests/day for the account. Slower polling alone cannot qualify
continuous all-day media monitoring under that shared limit.

Use the existing private Core network/origin for the single primary bridge,
operator preview/commands and PC-preparation helper. This avoids the Worker
entirely for those flows. No public video tunnel, new subscription or security
relaxation is needed. Private-device enrollment remains necessary on iPad.
Other public Chase/OTA/Facebook callers stay on their current routes; their
quotas and third-party auth/map/provider limits remain separate.

Candidate reduces duplicate work too: one heartbeat per two seconds, unchanged
capabilities are not rewritten, empty command polls do not write storage,
JPEG/HLS uploads require separate 20-second viewer demand. Local observation
and freshness stay at their existing cadence. Commands, leases, acknowledgments
and launcher jobs use atomic fsync/rename-backed private storage; bounded media
stays transient. A failed request returns outcome unknown and is never replayed.

## Source checkpoints

- Private backend: gateway branch fix/gateway-quota-budget-20261015, 74f6c69.
- Single private-primary bridge: 88b12e1. OBS itself does not restart.
- Private preparation helper: branch feat/private-prepare-agent-20261015.
- OPS feature port is based on 53ba204, preserving the other agent's Status
  Center polish; only the scoped Producer/launcher adapters are applied.

## Activation gates

1. Recheck current private static release and service entry before replacing
   either. Stop if another agent has advanced them. Use isolated clean releases.
2. Full typecheck/tests/lint/public and private builds. Verify actual private
   Node runtime and authenticated manifest/segment composition headers.
3. Retain current private OPS service entry and static override, private shadow
   service entry/state, native tasks/journals and both public rollback versions.
4. Announce before deploy/restart. Check Facebook and YouTube are freshly OFF,
   no pending public gateway command and no unresolved local output command.
5. Stage private backend and OPS adapter disabled first. Enable the private
   adapter with the same approved producer IDs, never roles alone. Credentials
   stay in protected server configuration and workstation DPAPI files.
6. Stop only the original bridge/helper, preserve journals, switch their pinned
   task actions and start one private consumer each. Never start a second active
   command consumer or restart OBS, MediaMTX or unrelated Core services.
7. Verify signed-in private Producer preview/HLS/audio, composition alignment,
   safe preview command acknowledgment, check-only preparation, reconnect and
   no public Worker calls from the migrated processes. Keep both outputs OFF.

No automatic fallback to the public Worker: private route loss is visible and
bounded; it must not restart public request flooding or duplicate commands.

## Rollback

Stop private consumers first. Restore saved task actions, primary credentials
and service/static overrides without deleting state. Start one previous bridge
and preparation helper, verify fresh OFF states and operator acknowledgments.
Public gateway 1d43ecc2-8c12-4e28-a72d-9ab2bb308d3e remains untouched. Preserve
original b31fa3c rollback 430056ec-de67-4640-9ed0-5ab6081d151e as well. Rollback
restores functionality, not quota safety; public polling can exhaust free quota.

Private comments/Chase/OTA route parity is not included in this candidate. Their
existing public services are preserved. Do not claim the private site has full
public-site parity until those separate routes pass qualification.
