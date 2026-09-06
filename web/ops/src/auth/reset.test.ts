import { describe, expect, it, vi } from "vitest";
import { passwordResetRedirect, requestPasswordReset } from "./reset";

describe("password reset UX helper", () => {
  it("requests a Supabase reset link with the update-password redirect", async () => {
    const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null });
    const result = await requestPasswordReset({ auth: { resetPasswordForEmail } }, " operator@example.com ", "https://ops.codeblackwx.com/");
    expect(result).toEqual({ ok: true });
    expect(resetPasswordForEmail).toHaveBeenCalledWith("operator@example.com", {
      redirectTo: "https://ops.codeblackwx.com/update-password",
    });
  });

  it("returns a safe provider failure without exposing account existence", async () => {
    const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: { message: "User not found", status: 400 } });
    const result = await requestPasswordReset({ auth: { resetPasswordForEmail } }, "missing@example.com", "https://ops.codeblackwx.com");
    expect(result.ok).toBe(false);
    expect(result.ok === false ? result.message : "").not.toMatch(/not found|user|account/i);
  });

  it("handles network failure safely", async () => {
    const resetPasswordForEmail = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const result = await requestPasswordReset({ auth: { resetPasswordForEmail } }, "operator@example.com", "https://ops.codeblackwx.com");
    expect(result).toEqual({ ok: false, message: "Reset service is unreachable from this browser session." });
  });

  it("normalizes redirect origins", () => {
    expect(passwordResetRedirect("https://ops.codeblackwx.com/")).toBe("https://ops.codeblackwx.com/update-password");
  });
});
