import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  server: { host: true },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        libraries: path.resolve(__dirname, "libraries.html"),
      },
      output: {
        manualChunks: undefined,
      },
    },
  },
  optimizeDeps: {
    exclude: ["pdfjs-dist"],
  },
});
