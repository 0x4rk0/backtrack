const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "extension", "dist");
const RELEASES = path.join(ROOT, "extension", "releases");

function assertBuilt(name) {
  const manifest = path.join(DIST, name, "manifest.json");
  if (!fs.existsSync(manifest)) {
    throw new Error(`Missing ${path.relative(ROOT, manifest)}. Run npm run build:extensions first.`);
  }
}

function packageDirectory(name, outputName) {
  assertBuilt(name);
  fs.mkdirSync(RELEASES, { recursive: true });

  const outputPath = path.join(RELEASES, outputName);
  fs.rmSync(outputPath, { force: true });
  execFileSync("zip", ["-qr", outputPath, "."], {
    cwd: path.join(DIST, name),
    stdio: "inherit"
  });
  console.log(`Created ${path.relative(ROOT, outputPath)}`);
}

packageDirectory("chrome", "backtrack-chrome.zip");
packageDirectory("firefox", "backtrack-firefox.xpi");
