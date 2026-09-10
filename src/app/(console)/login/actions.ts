"use server";

import { createClient } from "@/lib/supabase/server";

export type SendMagicLinkResult = { error: string | null; sent: boolean };

export async function sendMagicLink(
  _prev: SendMagicLinkResult,
  formData: FormData,
): Promise<SendMagicLinkResult> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    return { error: "Enter an email address.", sent: false };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // Supabase's default email template ("ConfirmationURL") verifies on
      // Supabase's own hosted /auth/v1/verify endpoint, then redirects here
      // with a ?code= param. exchangeCodeForSession trades that for a
      // session, then redirects to /app.
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/app`,
    },
  });

  if (error) {
    return { error: error.message, sent: false };
  }
  return { error: null, sent: true };
}
