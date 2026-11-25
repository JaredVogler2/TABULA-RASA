import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
const onVercel = Boolean(process.env.VERCEL);

/**
 * Static (non-nonce) Content-Security-Policy, following the documented
 * "Without Nonces" approach so every public page stays statically prerendered.
 * The app loads no third-party scripts, styles, fonts or frames and never renders
 * untrusted HTML: in-world text (including model output) is rendered as React text.
 * See docs/SECURITY.md for the trade-off discussion around 'unsafe-inline'.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(onVercel ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), accelerometer=(), gyroscope=(), magnetometer=(), browsing-topics=()",
  },
  ...(onVercel
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  reactStrictMode: true,
  // pg and pglite are server-only and must never be bundled for the browser.
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        // Owner and live endpoints must never be cached by any intermediary.
        source: "/api/(.*)",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
