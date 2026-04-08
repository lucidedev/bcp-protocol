/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === "production";

const nextConfig = {
  output: isProd ? "export" : undefined,
  distDir: isProd ? "../docs" : undefined,
  basePath: isProd ? "/bcp-protocol" : "",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
