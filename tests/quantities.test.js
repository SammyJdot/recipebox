import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuantity, scaleQuantity } from "../web/src/quantities.js";
import { loadConfig } from "../server/config.js";
import { password } from "./helpers.js";

test("serving scaling handles decimals, mixed fractions, unicode, thirds and nonnumeric notes", () => {
  assert.equal(parseQuantity("1 1/2"), 1.5);
  assert.equal(parseQuantity("1½"), 1.5);
  assert.equal(scaleQuantity("1 1/2", 0.5), "3/4");
  assert.equal(scaleQuantity("1/3", 2), "2/3");
  assert.equal(scaleQuantity("0.5", 3), "1 1/2");
  assert.equal(scaleQuantity("½", 0.5), "1/4");
  assert.equal(scaleQuantity("to taste", 2), "to taste");
  assert.equal(scaleQuantity("1/0", 2), "1/0");
  assert.equal(scaleQuantity(null, 2), "");
  assert.equal(scaleQuantity("1", 0), "1");
});
test("configuration requires deployment values and validates auth settings", () => {
  const env = {
    AUTH_MODE: "local",
    PUBLIC_URL: "http://localhost:3000",
    SESSION_SECRET: password(),
    DATA_DIR: "./.data",
  };
  assert.throws(() => loadConfig({}), /AUTH_MODE/);
  assert.equal(loadConfig(env).authMode, "local");
  assert.throws(
    () => loadConfig({ ...env, PUBLIC_URL: "http://localhost/subpath" }),
    /origin/,
  );
  assert.throws(() => loadConfig({ ...env, AUTH_MODE: "other" }), /AUTH_MODE/);
  assert.throws(
    () => loadConfig({ ...env, SESSION_SECRET: "short" }),
    /SESSION_SECRET/,
  );
  assert.throws(
    () => loadConfig({ ...env, ALLOW_LOCAL_REGISTRATION: "off" }),
    /ALLOW_LOCAL_REGISTRATION/,
  );
  assert.throws(() => loadConfig({ ...env, AUTH_MODE: "oidc" }), /OIDC_ISSUER/);
});
