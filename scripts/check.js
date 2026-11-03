import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { parse } from "yaml";
const excluded = new Set([
  ".git",
  "node_modules",
  "dist",
  ".data",
  ".artifacts",
  "test-results",
  "playwright-report",
]);
function walk(dir = ".") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    excluded.has(entry.name) || entry.name.startsWith(".env")
      ? []
      : entry.isDirectory()
        ? walk(join(dir, entry.name))
        : [join(dir, entry.name)],
  );
}
for (const path of walk()) {
  if (path.endsWith(".js"))
    assert.equal(
      spawnSync(process.execPath, ["--check", path], { stdio: "inherit" })
        .status,
      0,
      path,
    );
  if (
    /\.(js|jsx|json|yml|md)$/.test(path) ||
    ["Dockerfile", "NOTICE"].includes(path)
  ) {
    const text = readFileSync(path, "utf8");
    assert.ok(!/\/(?:home|Users)\//.test(text), `Machine path in ${path}`);
    assert.ok(
      !/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(text),
      `Private key in ${path}`,
    );
    assert.ok(
      !/\b(?:gh[pousr]_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{40,})\b/.test(
        text,
      ),
      `Credential in ${path}`,
    );
    assert.ok(
      !/@(?:gmail|outlook|hotmail)\.com/i.test(text),
      `Personal email in ${path}`,
    );
  }
}
const ci = parse(readFileSync(".github/workflows/ci.yml", "utf8"));
const release = parse(readFileSync(".github/workflows/release.yml", "utf8"));
assert.deepEqual(ci.on.push.branches, ["main"]);
assert.deepEqual(release.on.push.tags, ["v*"]);
assert.equal(release.jobs.publish.needs, "verify");
assert.ok(release.jobs.publish.steps.some((s) => s.with?.push === true));
assert.ok(!ci.jobs.verify.steps.some((s) => s.with?.push === true));
parse(readFileSync("docker-compose.yml", "utf8"));
assert.equal(
  JSON.parse(readFileSync("web/public/manifest.webmanifest")).name,
  "RecipeBox",
);
assert.match(
  readFileSync("LICENSE", "utf8"),
  /GNU AFFERO GENERAL PUBLIC LICENSE/,
);
console.log(
  "JavaScript syntax, YAML, manifest and source hygiene checks passed.",
);
