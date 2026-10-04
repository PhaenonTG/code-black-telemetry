import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CoreOpsProvider architecture", () => {
  it("owns the only Fabric feed subscription in the shared Core provider", () => {
    const provider = readFileSync(new URL("./CoreOpsProvider.tsx", import.meta.url), "utf8");
    const hook = readFileSync(new URL("./useCoreOps.ts", import.meta.url), "utf8");
    expect(provider.match(/consumeFabricStream\(/g)?.length).toBe(1);
    expect(hook).not.toContain("consumeFabricStream");
  });

  it("keeps feed cleanup and point-request cancellation in the shared provider", () => {
    const provider = readFileSync(new URL("./CoreOpsProvider.tsx", import.meta.url), "utf8");
    expect(provider).toContain("controller?.abort()");
    expect(provider).toContain("new AbortController()");
    expect(provider).toContain("controller.abort()");
    expect(provider).toContain("isCurrent(requestId)");
  });
});
