import type { NextConfig } from "next";

// TACG_STATIC=1 — статический экспорт для десктоп-оболочки Tauri (ADR-018):
// UI становится набором статических файлов (out/), которые вшиваются в exe.
// Обычная сборка (dev / web / standalone) не меняется.
const isStatic = process.env.TACG_STATIC === "1";

const nextConfig: NextConfig = {
  output: isStatic ? "export" : "standalone",
  images: isStatic ? { unoptimized: true } : undefined,
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
