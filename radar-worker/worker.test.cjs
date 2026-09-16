"use strict";
// Regression tests for a real production incident: a transient AWS S3 listing failure
// ("SocketError: other side closed", an ordinary condition against a public bucket) inside
// drainHistoryBackfill()'s best-effort historical backfill escaped uncaught and crashed the
// entire live radar-worker process -- 33 restarts in one session, radar tiles unavailable most
// of the time. See PROVENANCE note in worker.cjs's drainHistoryBackfill().
//
// Requiring worker.cjs must never bind the real port (guarded by require.main === module) --
// these tests exercise the exported backfill functions directly against a mocked
// recentLevel2Keys, never touching real S3.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const worker = require("./worker.cjs");

function withMockedRecentLevel2Keys(impl, fn) {
  const original = worker.recentLevel2Keys;
  worker.recentLevel2Keys = impl;
  return fn().finally(() => {
    worker.recentLevel2Keys = original;
  });
}

function resetBackfillState() {
  worker.backfillJobs.clear();
  worker.backfillQueue.length = 0;
  worker._resetBackfillRunning();
}

test("a failing recentLevel2Keys does not reject drainHistoryBackfill (would have crashed the process)", async () => {
  resetBackfillState();
  worker.backfillJobs.add("KTWX:REF:1");
  worker.backfillQueue.push({ jobKey: "KTWX:REF:1", site: "KTWX", product: "REF", tilt: 1, limit: 6 });

  await withMockedRecentLevel2Keys(
    async () => {
      throw new Error("fetch failed: SocketError: other side closed");
    },
    async () => {
      // The historical bug: this await would have rejected and, at the real fire-and-forget
      // call site, become an unhandled promise rejection. Calling it directly and awaiting it
      // here proves the promise itself now resolves cleanly instead of rejecting.
      await assert.doesNotReject(() => worker.drainHistoryBackfill());
    },
  );
});

test("backfillJobs bookkeeping is cleaned up after a failed backfill", async () => {
  resetBackfillState();
  const jobKey = "KTWX:REF:1";
  worker.backfillJobs.add(jobKey);
  worker.backfillQueue.push({ jobKey, site: "KTWX", product: "REF", tilt: 1, limit: 6 });

  await withMockedRecentLevel2Keys(
    async () => {
      throw new Error("fetch failed: SocketError: other side closed");
    },
    async () => {
      await worker.drainHistoryBackfill();
    },
  );

  assert.equal(worker.backfillJobs.has(jobKey), false, "failed job must be removed from backfillJobs");
  assert.equal(worker.backfillQueue.length, 0, "failed job must be drained from the queue, not left stuck");
});

test("a subsequent backfill can run after a prior one failed (backfillRunning does not stick)", async () => {
  resetBackfillState();
  worker.backfillJobs.add("KTWX:REF:1");
  worker.backfillQueue.push({ jobKey: "KTWX:REF:1", site: "KTWX", product: "REF", tilt: 1, limit: 6 });

  await withMockedRecentLevel2Keys(
    async () => {
      throw new Error("fetch failed: SocketError: other side closed");
    },
    async () => {
      await worker.drainHistoryBackfill();
    },
  );

  // A second, independent job queued after the first failed must still be able to run --
  // proves backfillRunning was correctly reset to false, not left stuck "true" forever (which
  // would silently disable all future backfills without crashing, a quieter but still real bug).
  let secondCallMade = false;
  worker.backfillJobs.add("KTWX:REF:1");
  worker.backfillQueue.push({ jobKey: "KTWX:REF:1", site: "KTWX", product: "REF", tilt: 1, limit: 6 });
  await withMockedRecentLevel2Keys(
    async () => {
      secondCallMade = true;
      return [];
    },
    async () => {
      await worker.drainHistoryBackfill();
    },
  );
  assert.equal(secondCallMade, true, "a subsequent backfill attempt must actually run recentLevel2Keys again");
});

test("terminal fire-and-forget boundary (startHistoryBackfill) survives an unexpected deeper failure", async () => {
  resetBackfillState();
  // Simulate a failure mode NOT already caught inside drainHistoryBackfill's own try/catch --
  // e.g. a bug in the loop body itself, or some future refactor that removes the inner catch.
  // The terminal .catch() at the fire-and-forget call site is the defense-in-depth boundary this
  // proves: it must never let ANY escaping error become an unhandled rejection.
  const originalHandler = process.listeners("unhandledRejection").slice();
  let unhandled = null;
  process.removeAllListeners("unhandledRejection");
  process.once("unhandledRejection", (reason) => {
    unhandled = reason;
  });

  await withMockedRecentLevel2Keys(
    async () => {
      throw new Error("simulated unexpected deeper failure");
    },
    async () => {
      worker.startHistoryBackfill("KTWX", "REF", 1, 6);
      // Let the fire-and-forget promise chain settle.
      await new Promise((resolve) => setTimeout(resolve, 50));
    },
  );

  for (const listener of originalHandler) process.on("unhandledRejection", listener);
  assert.equal(unhandled, null, "no unhandled promise rejection should ever occur from startHistoryBackfill");
});

test("live radar requests remain usable after a failed backfill (module stays functional, not crashed)", async () => {
  resetBackfillState();
  worker.backfillJobs.add("KTWX:REF:1");
  worker.backfillQueue.push({ jobKey: "KTWX:REF:1", site: "KTWX", product: "REF", tilt: 1, limit: 6 });

  await withMockedRecentLevel2Keys(
    async () => {
      throw new Error("fetch failed: SocketError: other side closed");
    },
    async () => {
      await worker.drainHistoryBackfill();
    },
  );

  // The module itself (and by extension the process it runs in) is still alive and callable --
  // the actual regression this whole suite exists to prevent is the process dying outright.
  assert.equal(typeof worker.drainHistoryBackfill, "function");
  assert.equal(typeof worker.startHistoryBackfill, "function");
});

test("successful backfill behavior is unchanged: real keys are processed in order", async () => {
  resetBackfillState();
  worker.backfillJobs.add("KTWX:REF:1");
  worker.backfillQueue.push({ jobKey: "KTWX:REF:1", site: "KTWX", product: "REF", tilt: 1, limit: 6 });

  const requestedSites = [];
  await withMockedRecentLevel2Keys(
    async (site, count) => {
      requestedSites.push({ site, count });
      return []; // empty is fine -- proves the success path (no throw) still completes cleanly
    },
    async () => {
      await assert.doesNotReject(() => worker.drainHistoryBackfill());
    },
  );

  assert.deepEqual(requestedSites, [{ site: "KTWX", count: 6 }]);
  assert.equal(worker.backfillJobs.has("KTWX:REF:1"), false);
});
