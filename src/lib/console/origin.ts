/**
 * Where a magic link should come back to.
 *
 * Pulled out of the login action as a pure function so it can be asserted rather
 * than trusted. It earned that: a fixed `NEXT_PUBLIC_SITE_URL` of
 * `http://localhost:3000` meant that requesting a link from the PHONE produced a
 * link pointing at the phone itself, which fails with no server-side trace at
 * all — the request never arrives, so there is nothing in any log but the
 * original `POST /login`. A silent failure is exactly the kind worth a check.
 *
 * The Host header is attacker-controlled in general, and building a redirect out
 * of it is how host-header injection works. So it is trusted only for loopback
 * and RFC1918 private addresses — which is the entire set of hosts this problem
 * exists for, since it is a "two devices on my home network" problem. Anything
 * else falls back to the configured value, and Supabase's own redirect
 * allow-list is a second gate behind that.
 */

const LOOPBACK = ['localhost', '127.0.0.1', '::1', '[::1]'];

export function isTrustedDevHost(host: string): boolean {
  const hostname = host.startsWith('[')
    ? host.slice(0, host.indexOf(']') + 1)
    : host.split(':')[0];

  if (LOOPBACK.indexOf(hostname) >= 0) return true;

  // RFC1918: 10/8, 192.168/16, 172.16/12. Note 172.32.x is NOT private, which
  // is the easy one to get wrong with a lazy `172\.` prefix match.
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;

  return false;
}

export function magicLinkOrigin(
  host: string | null,
  forwardedProto: string | null,
  configured: string | undefined,
): string {
  const fallback = configured && configured !== '' ? configured : 'http://localhost:3000';
  if (!host) return fallback;
  if (!isTrustedDevHost(host)) return fallback;

  const proto = forwardedProto === 'https' ? 'https' : 'http';
  return `${proto}://${host}`;
}
