import { defineConfig } from "vite";

// base condicional: subpasta no build (GitHub Pages), raiz no dev
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/nexus-run/" : "/",
  server: {
    port: 5182,
    strictPort: true,
    host: true,
  },
}));
