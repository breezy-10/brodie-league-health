import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  // The admin area was renamed to /settings; keep old bookmarks + Slack links working.
  async redirects() {
    return [
      { source: "/admin", destination: "/settings", permanent: true },
      { source: "/admin/:path*", destination: "/settings/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
