import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const tag = process.env.GITHUB_REF_NAME;
assert.match(
  tag || "",
  /^v\d+\.\d+\.\d+$/,
  "Release tags must use vMAJOR.MINOR.PATCH",
);
assert.equal(tag, `v${version}`, "Tag must match package.json version");
const changelog = readFileSync("CHANGELOG.md", "utf8");
const section = changelog
  .split(`## [${version}]`)[1]
  ?.split("\n## ")[0]
  ?.trim();
assert.ok(section?.length > 30, "Add a changelog entry before tagging");
if (process.argv.includes("--notes"))
  process.stdout.write(`${section.replace(/^\s*—[^\n]*\n/, "").trim()}\n`);
