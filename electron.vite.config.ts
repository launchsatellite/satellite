import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { z } from "zod";
import { thirdPartyLicenses, thirdPartyLicensesFile } from "./scripts/third-party-licenses.ts";
import { assetInlineLimit } from "./src/shared/asset-inline-limit.ts";
import { contentSecurityPolicy } from "./src/shared/content-security-policy.ts";

const { version } = z
  .object({ version: z.string().min(1).max(40) })
  .parse(JSON.parse(readFileSync("package.json", "utf8")));

export default defineConfig({
  main: {},
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } },
    },
  },
  renderer: {
    define: { satelliteVersion: JSON.stringify(version) },
    resolve: {
      alias: {
        "decode-named-character-reference": fileURLToPath(
          new URL("./node_modules/decode-named-character-reference/index.js", import.meta.url),
        ),
      },
    },
    plugins: [react(), tailwindcss(), thirdPartyLicenses()],
    build: {
      minify: true,
      assetsInlineLimit: assetInlineLimit,
      license: { fileName: thirdPartyLicensesFile },
    },
    server: { headers: { "Content-Security-Policy": contentSecurityPolicy("development") } },
  },
});
