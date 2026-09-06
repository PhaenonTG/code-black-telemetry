import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CoreOpsProvider architecture", () => {
  it("owns the only Fabric WebSocket construction in the shared Core provider", () => {
    const provider = readFileSync(new URL("./CoreOpsProvider.tsx", import.meta.url), "utf8");
    const hook = readFileSync(new URL("./useCoreOps.ts", import.meta.url), "utf8");
    expect(provider.match(/new WebSocket/g)?.length).toBe(1);
    expect(hook).not.toContain("new WebSocket");
  });

  it("keeps socket cleanup and point-request cancellation in the shared provider", () => {
    const provider = readFileSync(new URL("./CoreOpsProvider.tsx", import.meta.url), "utf8");
    expect(provider).toContain("socket?.close()");
    expect(provider).toContain("new AbortController()");
    expect(provider).toContain("controller.abort()");
    expect(provider).toContain("isCurrent(requestId)");
  });
});
