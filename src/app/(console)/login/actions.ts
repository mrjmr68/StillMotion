"use server";

import { headers } from "next/headers";
import { magicLinkOrigin } from "@/lib/console/origin";
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

  /*
   * The link comes back to whichever device asked for it.
   *
   * A fixed site URL cannot be right for a two-screen app developed on a LAN:
   * baked with `localhost:3000`, a link requested on the phone points the phone
   * at itself. See `magicLinkOrigin` for why the Host header is only trusted for
   * private addresses.
   */
  const requestHeaders = await headers();
  const origin = magicLinkOrigin(
    requestHeaders.get("host"),
    requestHeaders.get("x-forwarded-proto"),
    process.env.NEXT_PUBLIC_SITE_URL,
  );

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // Supabase's default email template ("ConfirmationURL") verifies on
      // Supabase's own hosted /auth/v1/verify endpoint, then redirects here
      // with a ?code= param. exchangeCodeForSession trades that for a
      // session, then redirects to /app.
      //
      // This URL must ALSO be allow-listed under Authentication → URL
      // Configuration → Redirect URLs in the Supabase dashboard. When it isn't,
      // Supabase quietly substitutes the project's Site URL rather than
      // failing — which reproduces the original bug with no error to read.
      emailRedirectTo: `${origin}/auth/confirm?next=/app`,
    },
  });

  if (error) {
    return { error: error.message, sent: false };
  }
  return { error: null, sent: true };
}
