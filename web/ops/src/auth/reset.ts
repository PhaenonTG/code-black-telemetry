export type PasswordResetResult = { ok: true } | { ok: false; message: string };

interface ResetClient {
  auth: {
    resetPasswordForEmail(
      email: string,
      options: { redirectTo: string },
    ): Promise<{ error: { message?: string; status?: number } | null }>;
  };
}

export function passwordResetRedirect(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/update-password`;
}

export function safePasswordResetMessage(error: { message?: string; status?: number } | null | undefined): string {
  if (!error) return "";
  if (error.status === 429 || /rate|too many/i.test(error.message ?? "")) {
    return "Reset service is rate-limited. Wait a few minutes and try again.";
  }
  if (/fetch|network|failed|unreachable/i.test(error.message ?? "")) {
    return "Reset service is unreachable from this browser session.";
  }
  return "Reset email could not be requested. Check the address format and try again.";
}

export async function requestPasswordReset(
  client: ResetClient,
  email: string,
  origin: string,
): Promise<PasswordResetResult> {
  try {
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: passwordResetRedirect(origin),
    });
    if (error) return { ok: false, message: safePasswordResetMessage(error) };
    return { ok: true };
  } catch {
    return { ok: false, message: "Reset service is unreachable from this browser session." };
  }
}
