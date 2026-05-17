const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "extension", "src");
const MANIFESTS = path.join(ROOT, "extension", "manifests");
const DIST = path.join(ROOT, "extension", "dist");

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function build(name) {
  const out = path.join(DIST, name);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  copyFile(path.join(MANIFESTS, `${name}.json`), path.join(out, "manifest.json"));
  copyFile(path.join(SRC, "content.js"), path.join(out, "content.js"));
  copyFile(path.join(SRC, "background.js"), path.join(out, "background.js"));
}

build("chrome");
build("firefox");

console.log(`Built extensions in ${path.relative(ROOT, DIST)}`);
