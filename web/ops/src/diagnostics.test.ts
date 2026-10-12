import { describe, expect, it } from "vitest";
import { redactDiagnosticMessage } from "./diagnostics";

describe("diagnostic redaction", () => {
  it("keeps failure context while removing common credentials and precise coordinates", () => {
    const safe = redactDiagnosticMessage("Fetch https://core.example/api?access_token=top-secret failed: Bearer abc.def; lat=36.4871 lon=-94.1234 at 36.4871,-94.1234");
    expect(safe).toContain("Fetch https://core.example/api?access_token=[REDACTED]");
    expect(safe).toContain("Bearer [REDACTED]");
    expect(safe).toContain("lat=[REDACTED] lon=[REDACTED]");
    expect(safe).toContain("[COORDINATES_REDACTED]");
    expect(safe).not.toContain("top-secret");
    expect(safe).not.toContain("36.4871");
  });

  it("bounds saved browser diagnostics", () => {
    expect(redactDiagnosticMessage("x".repeat(500))).toHaveLength(320);
  });
});
