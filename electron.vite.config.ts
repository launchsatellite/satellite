import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { thirdPartyLicenses, thirdPartyLicensesFile } from "./scripts/third-party-licenses.ts";
import { assetInlineLimit } from "./src/shared/asset-inline-limit.ts";
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
    plugins: [react(), tailwindcss(), thirdPartyLicenses()],
    build: {
      minify: true,
      assetsInlineLimit: assetInlineLimit,
      license: { fileName: thirdPartyLicensesFile },
    },
    server: { headers: { "Content-Security-Policy": contentSecurityPolicy("development") } },
  },
});
