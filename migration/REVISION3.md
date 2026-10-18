# Revision 3 — executable Worker build-path repair

Parent: immutable R2 `9c6a4575bfef8ad606e08e37b0ff91f7a56d8e83`. Branch `feat/public-ops-parity-r3-build-20261018`. This narrow revision responds to Task 4's PUBLIC-OPS-PARITY-R2-INDEPENDENT-REVIEW.md. R2's checkout and ZIP are preserved. No browser/account work, deployment, configuration/permission/auth changes or production mutations occurred.

## Correction

The R2 manual build's comment named parityEntry.ts, but its executable entryPoints still named entry.ts. The text-presence regression assertion therefore passed while the manual repair artifact lost radar/coordination dispatch. R2's claim that both build selectors were correctly wired was wrong; the independent review reproduced the failure.

R3 changes the actual manual entryPoints to worker/parityEntry.ts and regenerates functional-wiring.patch from the pinned R1 base with that executable correction. Vite's existing correct entry is unchanged. The role-policy patch remains byte-identical and unapplied. No runtime feature/UI/Producer/Core policy change is included.

## Executable verification

`tests/worker-build-paths.cjs` executes the actual manual script in a child process, then evaluates the actual production Vite configuration and invokes its real ops-pages-worker closeBundle hook. Both invoke real installed esbuild and write the actual dist/_worker.js. A test-only loader resolves already installed dependencies without altering source/configuration or entry expressions. Production-config evaluation uses synthetic nonsecret environment values and refuses real .env files. This is Worker-only verification, not a new full Vite client rebuild.

The resulting bytes are copied unchanged to evidence and dynamically imported. Each artifact passes 61 checks: radar frames/metadata/tiles and coordination return 503 JSON when unconfigured, 401 anonymously and 405 on unsupported methods; no SPA fallback occurs; an injected local fake origin receives the exact dispatch with forged identity headers stripped; Producer is not captured. Separate synthetic Core probes demonstrate the role patch is still unapplied. Neither auth credentials nor a real backend are used.

Both outputs are 27,496 bytes, SHA256:

`0a996b0839ef2f2b418c907595fca3bd664a66db6afa020af82960c08d86cfb8`

`verify-pages-build.mjs` now checks the new route gates and imports/probes its actual emitted Worker through `verify-worker-dispatch.mjs`. The public build verifier's standard checks do not assert the retained Core role policy; that optional test-only proof can be updated independently when policy activation is approved.

The broader parity regression removes both comment/text-presence assertions. It loads the manual **emitted artifact**, not a separate candidate source bundle, for its Pages→origin→fake-backend tests. Its 413 assertions/35 Core route-method cases pass; the two removed text assertions explain the count change from 415. Both build outputs are byte-identical, and both independently pass dispatch checks and the actual Pages build verifier.

## Negative control

The test executes the pinned R2 manual script in a disposable fixture tree, preserving its misleading comment and wrong executable entry. It compiles successfully to the retained artifact SHA256:

`eaa75514453006a5219db1ef34b762710730cff72b1f484f1df90e5ef289eb6a`

That artifact is rejected by both the dispatch checker and the strengthened Pages verifier (SPA HTTP 200 where API HTTP 503 is required), despite a correct candidate route gate. No writes are made to the R2 checkout. This proves the new checks detect the independently reproduced failure rather than matching a filename/comment.

## Scope and next step

No new frontend/browser/model/native Linux qualification is claimed or needed for this build-only change. Prior R2 evidence keeps its stated limits, including seven identical baseline Worker strict-TypeScript diagnostics. Real auth/backend/route/account evidence and policy/exposure approval remain separate migration gates. The browser-enabled RDP task owns the current dashboard evidence work; this revision did not duplicate it.

Next: independently verify this new freeze and emitted-artifact evidence. Full migration and production activation remain HOLD. The Core authorization patch is not applied or selected by this change.

Run the targeted suite from the checkout with existing dependencies, optionally setting OPS_TEST_DEPS to their node_modules directory and OPS_TEST_OUTPUT to a writable evidence directory:

`node tests/public-parity-regression.cjs`

No installation, real account, network or browser session is required. CLI/file fixtures are confined to the new checkout's ignored dist and the specified output/temp directory.
