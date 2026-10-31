import { defineConfig } from "vite";

// base "./" so the same build works on GitHub Pages (/MK-DEX/) and inside the Capacitor APK.
export default defineConfig({
  base: "./",
  build: { target: "es2022", outDir: "dist" },
  optimizeDeps: {
    // Tango ships the scrcpy server via `new URL(..., import.meta.url)` — don't pre-bundle it.
    exclude: ["@yume-chan/fetch-scrcpy-server"],
  },
});
