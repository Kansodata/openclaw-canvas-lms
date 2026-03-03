import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const filesToScan = [
  "README.md",
  "openclaw.plugin.json",
  "index.ts",
  "src/canvas-lms-tool.ts",
];

const patterns = [
  /sk-live-[a-zA-Z0-9]+/g,
  /ghp_[a-zA-Z0-9]{20,}/g,
  /xox[baprs]-[a-zA-Z0-9-]+/g,
  /AIza[0-9A-Za-z-_]{35}/g,
  /-----BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY-----/g,
  /client_secret=[^\s&]+/gi,
];

const violations = [];
for (const relativePath of filesToScan) {
  const absolutePath = resolve(repoRoot, relativePath);
  const content = readFileSync(absolutePath, "utf8");
  for (const pattern of patterns) {
    if (pattern.test(content)) {
      violations.push({ relativePath, pattern: String(pattern) });
    }
  }
}

if (violations.length > 0) {
  console.error("verify-no-secrets: potential secret patterns detected");
  for (const violation of violations) {
    console.error(`- ${violation.relativePath}: ${violation.pattern}`);
  }
  process.exit(1);
}

console.log("verify-no-secrets: ok");
