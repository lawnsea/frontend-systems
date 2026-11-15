import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build, defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Serves `file` unmodified at `path`. worker-dom's worker script must reach
 * the worker byte for byte, and Vite rewrites scripts it serves itself.
 */
function rawScript(path: string, file: string): Plugin {
  return {
    name: "raw-script",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== path) return next();
        res.setHeader("Content-Type", "text/javascript");
        res.end(await readFile(file));
      });
    },
  };
}

/**
 * Serves `entry`, bundled as one classic script, at `path`. worker-dom fetches
 * the subtree's source and runs it after its own, so it can't be a module.
 */
function classicScript(path: string, entry: string): Plugin {
  return {
    name: "classic-script",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== path) return next();
        try {
          const result = (await build({
            configFile: false,
            logLevel: "warn",
            plugins: [react()],
            define: { "process.env.NODE_ENV": JSON.stringify("development") },
            build: { write: false, minify: false, lib: { entry, formats: ["iife"], name: "subtree" } },
          })) as { output: { code: string }[] }[] | { output: { code: string }[] };
          const [{ output }] = Array.isArray(result) ? result : [result];
          res.setHeader("Content-Type", "text/javascript");
          res.end(output[0].code);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    classicScript("/subtree.js", "src/subtree.tsx"),
    rawScript("/worker-dom.js", createRequire(import.meta.url).resolve("@lawnsea/worker-dom/worker.js")),
  ],
});
