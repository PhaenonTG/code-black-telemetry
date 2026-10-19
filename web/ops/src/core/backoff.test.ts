import { describe, expect, it } from "vitest";
import { BoundedBackoff } from "./backoff";

describe("BoundedBackoff", () => {
  it("doubles reconnect delays up to a bound and can reset after a good socket", () => {
    const backoff = new BoundedBackoff(2, 10);
    expect([backoff.next(), backoff.next(), backoff.next(), backoff.next()]).toEqual([2, 4, 8, 10]);
    backoff.reset();
    expect(backoff.next()).toBe(2);
  });
});
