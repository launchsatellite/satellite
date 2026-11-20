import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { contentSecurityPolicy } from "./src/shared/content-security-policy.ts";

export default defineConfig({
  main: {},
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    build: { minify: true },
    server: { headers: { "Content-Security-Policy": contentSecurityPolicy("development") } },
  },
});
