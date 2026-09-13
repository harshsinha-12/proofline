import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  async redirects() {
    return [
      {
        source: "/research/demo",
        destination: "/research/run_baca2bc42a3947ca84a7e544",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
