import { updateSession } from "@/lib/supabase/proxy";
import { type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // The stage and its polling endpoints are excluded because the television is
  // never authenticated (spec §3: "you never type on the TV") — those requests
  // carry no Supabase cookie at all, so `getClaims()` has nothing to refresh and
  // would just be an auth round-trip per poll, roughly one per second for the
  // whole session.
  //
  // Written as extra negative lookaheads on the EXISTING pattern rather than as
  // a positive matcher, so nothing currently covered silently falls out. The
  // `(?:/|$)` anchors stop a future `/stages` being excluded by accident.
  // Matcher values must stay static literals — Next analyses them at build time.
  matcher: [
    "/((?!api/stage(?:/|$)|stage(?:/|$)|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
