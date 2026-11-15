import { glob, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { build, normalizePath, parseAst, type Plugin, type ResolvedConfig } from "vite";

export interface WorkerReactOptions {
  /** Globs, relative to the Vite root, of modules to check for `'use worker'`. */
  include?: string[];
}

const SUBTREE_SCRIPT = "worker-react/subtree.js";
const DOM_SCRIPT = "worker-react/worker-dom.js";
// Library mode resolves its entry against the root, so match by suffix.
const ENTRY_NAME = "virtual:worker-react-entry";
const ENTRY = "\0worker-react-entry";
const SCRIPT = /\.(?:[cm]?[jt]sx?)$/;

function langOf(file: string): "js" | "jsx" | "ts" | "tsx" {
  const ext = path.extname(file).replace(/^\.[cm]?/, ".");
  return ext === ".tsx" ? "tsx" : ext === ".ts" ? "ts" : ext === ".jsx" ? "jsx" : "js";
}

/** Whether `code` starts with a `'use worker'` directive. */
export function hasUseWorkerDirective(code: string, file: string): boolean {
  if (!code.includes("use worker")) return false;
  for (const node of parseAst(code, { lang: langOf(file) }).body as any[]) {
    if (node.type !== "ExpressionStatement" || typeof node.directive !== "string") return false;
    if (node.directive === "use worker") return true;
  }
  return false;
}

/** The names of the values a module exports. */
export function exportNames(code: string, file: string): string[] {
  const names: string[] = [];
  for (const node of parseAst(code, { lang: langOf(file) }).body as any[]) {
    if (node.type === "ExportDefaultDeclaration") {
      names.push("default");
    } else if (node.type === "ExportAllDeclaration") {
      throw new Error(`${file}: 'use worker' modules can't use \`export *\`. Export each component by name.`);
    } else if (node.type === "ExportNamedDeclaration" && node.exportKind !== "type") {
      const declaration = node.declaration;
      if (declaration?.type === "VariableDeclaration") {
        for (const { id } of declaration.declarations) {
          if (id.type !== "Identifier") {
            throw new Error(`${file}: 'use worker' modules can't export destructured names. Export each component by name.`);
          }
          names.push(id.name);
        }
      } else if (declaration?.id) {
        if (!declaration.type.startsWith("TS")) names.push(declaration.id.name);
      }
      for (const specifier of node.specifiers ?? []) {
        if (specifier.exportKind !== "type") names.push(specifier.exported.name ?? specifier.exported.value);
      }
    }
  }
  return names;
}

/**
 * Runs the exports of modules that start with `'use worker'` in a worker. In
 * the host's bundle, each export becomes a component that renders it in a
 * worker; the modules and everything they import go in one worker bundle.
 */
export function workerReact(options: WorkerReactOptions = {}): Plugin {
  const include = options.include ?? ["src/**/*.{js,jsx,ts,tsx,mjs,mts}"];
  const domFile = createRequire(import.meta.url).resolve("@lawnsea/worker-dom/worker.js");
  let config: ResolvedConfig;
  let bundled: Promise<string> | undefined;

  const idOf = (file: string) => normalizePath(path.relative(config.root, file));

  async function findWorkerModules(): Promise<string[]> {
    const files: string[] = [];
    for await (const file of glob(include, { cwd: config.root, exclude: (f) => f.includes("node_modules") })) {
      const absolute = path.resolve(config.root, file);
      if (hasUseWorkerDirective(await readFile(absolute, "utf8"), absolute)) files.push(absolute);
    }
    return files.sort();
  }

  async function bundleWorker(): Promise<string> {
    const modules = await findWorkerModules();
    const entry = [
      `import { startWorker } from "worker-react/worker";`,
      ...modules.map((file, i) => `import * as m${i} from ${JSON.stringify(normalizePath(file))};`),
      `startWorker({ ${modules.map((file, i) => `${JSON.stringify(idOf(file))}: m${i}`).join(", ")} });`,
    ].join("\n");
    const result = (await build({
      configFile: false,
      root: config.root,
      logLevel: "warn",
      resolve: { alias: config.resolve.alias },
      define: { "process.env.NODE_ENV": JSON.stringify(config.isProduction ? "production" : "development") },
      oxc: { jsx: { runtime: "automatic" } },
      plugins: [
        {
          name: "worker-react:entry",
          resolveId: (id) => (id.endsWith(ENTRY_NAME) ? ENTRY : undefined),
          load: (id) => (id === ENTRY ? entry : undefined),
        },
      ],
      build: {
        write: false,
        minify: config.isProduction,
        lib: { entry: ENTRY_NAME, formats: ["iife"], name: "workerReact" },
      },
    })) as { output: { code?: string }[] }[] | { output: { code?: string }[] };
    const [{ output }] = Array.isArray(result) ? result : [result];
    return output[0].code!;
  }

  return {
    name: "worker-react",
    enforce: "pre",

    configResolved(resolved) {
      config = resolved;
    },

    transform(code, id) {
      const file = id.split("?")[0];
      if (!SCRIPT.test(file) || file.includes("/node_modules/") || !hasUseWorkerDirective(code, file)) return;
      const scripts = JSON.stringify({ src: config.base + SUBTREE_SCRIPT, domURL: config.base + DOM_SCRIPT });
      const moduleId = JSON.stringify(idOf(file));
      return [
        `import { createWorkerReference } from "worker-react";`,
        `const scripts = ${scripts};`,
        ...exportNames(code, file).map((name) =>
          name === "default"
            ? `export default createWorkerReference(${moduleId}, "default", scripts);`
            : `export const ${name} = createWorkerReference(${moduleId}, ${JSON.stringify(name)}, scripts);`,
        ),
      ].join("\n");
    },

    configureServer(server) {
      server.watcher.on("all", () => {
        bundled = undefined;
      });
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0];
        try {
          if (url === config.base + SUBTREE_SCRIPT) {
            bundled ??= bundleWorker();
            const code = await bundled.catch((error) => {
              bundled = undefined;
              throw error;
            });
            res.setHeader("Content-Type", "text/javascript");
            res.end(code);
          } else if (url === config.base + DOM_SCRIPT) {
            // Served unmodified: worker-dom runs it as text, and Vite rewrites scripts it serves.
            res.setHeader("Content-Type", "text/javascript");
            res.end(await readFile(domFile));
          } else {
            next();
          }
        } catch (error) {
          next(error);
        }
      });
    },

    async generateBundle() {
      if (config.build.ssr) return;
      this.emitFile({ type: "asset", fileName: SUBTREE_SCRIPT, source: await bundleWorker() });
      this.emitFile({ type: "asset", fileName: DOM_SCRIPT, source: await readFile(domFile) });
    },
  };
}
