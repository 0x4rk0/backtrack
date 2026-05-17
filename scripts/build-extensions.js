const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "extension", "src");
const MANIFESTS = path.join(ROOT, "extension", "manifests");
const DIST = path.join(ROOT, "extension", "dist");
const DEBUG_MODE = ["1", "true", "full"].includes(String(process.env.BACKTRACK_DEBUG || ""))
  ? String(process.env.BACKTRACK_DEBUG)
  : "0";

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copySource(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const code = fs
    .readFileSync(source, "utf8")
    .replaceAll("__BACKTRACK_DEBUG__", DEBUG_MODE);
  fs.writeFileSync(target, code);
}

function build(name) {
  const out = path.join(DIST, name);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  copyFile(path.join(MANIFESTS, `${name}.json`), path.join(out, "manifest.json"));
  copySource(path.join(SRC, "content.js"), path.join(out, "content.js"));
  copySource(path.join(SRC, "background.js"), path.join(out, "background.js"));
}

build("chrome");
build("firefox");

console.log(`Built extensions in ${path.relative(ROOT, DIST)}${DEBUG_MODE !== "0" ? ` with debug=${DEBUG_MODE}` : ""}`);
