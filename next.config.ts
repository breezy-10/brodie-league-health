import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  // Conservative security headers (no CSP — inline theme script + Supabase).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  // The admin area was renamed to /settings; keep old bookmarks + Slack links working.
  async redirects() {
    return [
      { source: "/admin", destination: "/settings", permanent: true },
      { source: "/admin/:path*", destination: "/settings/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
