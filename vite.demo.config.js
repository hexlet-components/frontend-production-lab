import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config.js";

// Демо для GitHub Pages собирается из demo/ в dist-demo/.
// Обычная сборка из уроков этот конфиг не использует.
export default mergeConfig(
  base,
  defineConfig({
    root: "demo",
    publicDir: "../public",
    build: { outDir: "../dist-demo", emptyOutDir: true },
  }),
);
