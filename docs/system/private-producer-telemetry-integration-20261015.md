# Combined private OPS candidate

Owner-approved coordination with the OPS agent established a deployment hold.
Baseline: telemetry checkpoint e7b01dd76c5430e5bd1aad38cce4e2286f8e9e4f,
private static status-polish-20261015-r17, server pilot-20261015-r7.

The combined release preserves the telemetry checkpoint, Status Center polish,
bounded/shared-in-flight authentication, browser cancellation and stale-report
retention. Producer controls, Prepare PC and streaming work tracking are wired
into real pages. Producer auth uses the same bounded helper; abandoned Producer
control/media upstream requests are cancelled and uncertain commands are not
retried. HLS composition and frame timestamp headers survive the private relay.

Validation: full typecheck, 292 Vitest tests and 10 Node server tests passed.
Public/private frontend builds and private Node gateway build passed. Lint:
zero errors, 17 pre-existing application warnings. On Core Node 18.19.1, all
15 private Producer/server compatibility tests passed in an isolated /tmp
directory; no active service or configuration was changed by those tests.

First rollout is private OPS UI/server only. Leave
OPS_PRIVATE_PRODUCER_CONTROLS_ENABLED absent/false until the separately tested
private backend, single primary bridge and preparation helper are activated.
Do not send any Facebook/YouTube command. Do not restart OBS or deploy public
gateway/Pages. Moving UI code alone does not fix live Worker quota consumption.

Before rollout, recheck the agreed live static/server baseline and back up the
exact zzzz-landscape.conf override. Deploy from a clean detached worktree using
the revised wrapped deploy-private-ops.ps1, including dist-private and server
entry script, not just static assets. Afterward verify trusted TLS, unauthorized
401 boundaries, authenticated Status Center and disabled Producer controls.

Rollback: restore the saved pre-cutover zzzz-landscape.conf, daemon-reload and
restart only codeblack-private-ops.service. This restores BOTH r17 static assets
and the previous pilot-r7 server entry. Keep all immutable releases, state,
branches and task journals. Public gateway and its original b31fa3c rollback
remain unchanged.

Remaining free quota cutover: backend 74f6c69, bridge 88b12e1 and preparation
helper 81fdf54 require protected credential configuration, planned single-
consumer activation and authenticated live-media/acknowledgment qualification.
Private Facebook comments/Chase/OTA route parity remains a separate gate; their
current public services are preserved, not silently replaced or claimed ready.
