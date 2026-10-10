import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Arena HTTPS previews proxy this server; do not reject their dev/HMR requests.
  allowedDevOrigins: ["localhost", "127.0.0.1", "*.e2b.app"],
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }, {
      source: "/api/:path*",
      headers: [{ key: "Cache-Control", value: "no-store" }],
    }];
  },
};

export default nextConfig;
