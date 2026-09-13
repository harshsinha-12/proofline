import type { NextConfig } from "next";
import { DEMO_LIVE_RUN_ID } from "./src/lib/demo";

const nextConfig: NextConfig = {
  reactCompiler: true,
  async redirects() {
    return [
      {
        source: "/research/demo",
        destination: `/research/${DEMO_LIVE_RUN_ID}`,
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
