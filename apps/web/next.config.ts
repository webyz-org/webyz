import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (apps/web/Dockerfile copies
  // .next/standalone). Harmless for `next dev` and a plain `next build`.
  output: "standalone",
  // The monorepo root, so file tracing resolves workspace dependencies.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  experimental: {
    // The whole site's CSS is 9 KB gzipped. Inlined in the HTML it stops being
    // a render-blocking round trip before first paint (Lighthouse mobile:
    // 150 ms, 10 Sep 2026); the pages are few and static, so the repeat-visit
    // cache loss is nothing.
    inlineCss: true,
  },
};

export default nextConfig;
