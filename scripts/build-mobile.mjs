import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const webDir = path.resolve(rootDir, "www");

if (path.dirname(webDir) !== rootDir || path.basename(webDir) !== "www") {
  throw new Error(`Refusing to replace unexpected web directory: ${webDir}`);
}

const normalizeOrigin = (value, fallback) =>
  String(value || fallback || "").trim().replace(/\/$/, "");

const runtimeConfig = {
  appApiOrigin: normalizeOrigin(
    process.env.PARKING_APP_API_ORIGIN,
    "http://10.0.2.2:8080",
  ),
  backendOrigin: normalizeOrigin(
    process.env.PARKING_BACKEND_ORIGIN,
    "http://10.0.2.2:3001",
  ),
};

await rm(webDir, { recursive: true, force: true });
await mkdir(webDir, { recursive: true });

let html = await readFile(path.join(rootDir, "index.html"), "utf8");
html = html
  .replace('href="/manifest.webmanifest"', 'href="./manifest.webmanifest"')
  .replace(
    "</head>",
    '    <script src="./mobile-config.js"></script>\n  </head>',
  )
  .replace(
    "</body>",
    '    <script type="module" src="./mobile-entry.js"></script>\n  </body>',
  );

await writeFile(path.join(webDir, "index.html"), html, "utf8");
await cp(
  path.join(rootDir, "manifest.webmanifest"),
  path.join(webDir, "manifest.webmanifest"),
);
await writeFile(
  path.join(webDir, "mobile-config.js"),
  `window.PARKING_MATE_RUNTIME_CONFIG = Object.freeze(${JSON.stringify(runtimeConfig, null, 2)});\n`,
  "utf8",
);

await build({
  entryPoints: [path.join(rootDir, "mobile", "mobile-entry.js")],
  bundle: true,
  format: "esm",
  minify: true,
  outfile: path.join(webDir, "mobile-entry.js"),
  sourcemap: true,
  target: ["chrome120"],
});

console.log(`Mobile web bundle: ${webDir}`);
console.log(`App API: ${runtimeConfig.appApiOrigin}`);
console.log(`Backend API: ${runtimeConfig.backendOrigin}`);
