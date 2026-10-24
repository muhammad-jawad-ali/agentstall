import type { NextConfig } from "next";

// The browser only talks to this app; these paths are forwarded to the AgentStall API service.
const apiUrl = process.env.API_URL ?? "http://localhost:8787";

const nextConfig: NextConfig = {
  // Listing extraction sends a photo to Gemini and can take 30s+ on the free tier.
  experimental: { proxyTimeout: 120_000 },
  async redirects() {
    return [
      { source: "/desk", destination: "/stall", permanent: false },
      { source: "/console", destination: "/shop", permanent: false },
    ];
  },
  async rewrites() {
    return ["/api/:path*", "/demo-photos/:path*", "/health", "/s/:path*", "/mcp", "/checkout/:path*", "/mock-paypal/:path*"].map((source) => ({
      source,
      destination: `${apiUrl}${source}`,
    }));
  },
};

export default nextConfig;
