import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    // `node` stays the DEFAULT so the logic/Dexie suites keep running without a
    // DOM (they're faster for it). Component tests opt in per-file with a
    //   // @vitest-environment jsdom
    // docblock at the top — see src/components/*.test.tsx.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
