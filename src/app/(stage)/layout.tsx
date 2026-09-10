/**
 * The stage's own root layout.
 *
 * This is a SECOND root layout, not a nested one — the console lives under
 * `(console)` with its own. That split is the only way to keep the console's
 * two webfonts and Tailwind preflight out of this document, and spec §3 is
 * explicit that `/stage` "does not share the console's component library."
 *
 * On a set whose browser is roughly a phone browser from several years ago,
 * blocking first paint on webfont downloads for the one screen whose entire
 * brief is legibility in the first second is a bad trade. `stage.css` is the
 * only stylesheet here.
 */

import type { Metadata, Viewport } from 'next';
import './stage.css';

export const metadata: Metadata = {
  title: 'StillMotion',
  // A television is not a search result.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The remote cannot pinch-zoom, and a stray zoom would be unrecoverable
  // without a pointer.
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0B0B0C',
};

export default function StageLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
