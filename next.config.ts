import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * The console is a phone surface, so in development it is loaded from this
   * machine's LAN address rather than localhost. Next's dev server refuses to
   * serve its own chunks and the HMR socket to an origin it doesn't recognise,
   * which leaves the page shell rendering and every interaction dead — a
   * failure that looks like broken code and isn't.
   *
   * Development only. It has no effect on `next build`.
   */
  allowedDevOrigins: ["192.168.0.13"],
};

export default nextConfig;
