import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const pkgPath = path.join(root, "package.json");
const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
const xpiPath = path.join(root, `translate-for-readingmode-${pkg.version}.xpi`);
await rm(xpiPath, { force: true });
await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "content", "scripts"), { recursive: true });
await mkdir(path.join(dist, "content", "icons"), { recursive: true });
await build({
  entryPoints: [path.join(root, "src", "index.ts")],
  outfile: path.join(dist, "content", "scripts", "readtrans.js"),
  bundle: true,
  format: "iife",
  globalName: "ReadTransPlugin",
  platform: "browser",
  target: "firefox140",
  sourcemap: false,
});
await build({
  entryPoints: [path.join(root, "src", "preferences.ts")],
  outfile: path.join(dist, "content", "scripts", "preferences.js"),
  bundle: true,
  format: "iife",
  globalName: "ReadTransPreferences",
  platform: "browser",
  target: "firefox140",
  sourcemap: false,
});
await cp(path.join(root, "bootstrap.js"), path.join(dist, "bootstrap.js"));
await cp(path.join(root, "manifest.json"), path.join(dist, "manifest.json"));
await cp(path.join(root, "preferences.xhtml"), path.join(dist, "content", "preferences.xhtml"));
await cp(path.join(root, "assets", "icons", "icon-48.png"), path.join(dist, "content", "icons", "icon-48.png"));
await cp(path.join(root, "assets", "icons", "icon-96.png"), path.join(dist, "content", "icons", "icon-96.png"));
await cp(path.join(root, "assets", "icons", "readtrans-icon.svg"), path.join(dist, "content", "icons", "readtrans-icon.svg"));
await cp(path.join(root, "assets", "icons", "readtrans-menu.svg"), path.join(dist, "content", "icons", "readtrans-menu.svg"));
const manifestPath = path.join(dist, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.version = pkg.version;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
execFileSync("zip", ["-qr", xpiPath, "."], {
  cwd: dist,
});
