import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import bcrypt from "bcryptjs";
import { fixture, password } from "./helpers.js";
import { createLogger, auditHelper } from "../server/logging.js";

test("out-of-band reset hashes stdin password, revokes sessions and audits without exposing passwords", async (t) => {
  const f = await fixture(t),
    c = f.client();
  const user = await c.register("reset-member");
  const next = password();
  const result = spawnSync(
    process.execPath,
    ["server/reset-password.js", "reset-member"],
    {
      env: { ...process.env, DATA_DIR: f.dir },
      input: `${next}\n`,
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const row = f.inspect(
    "SELECT password_hash FROM users WHERE id=?",
    user.id,
  )[0];
  assert.ok(await bcrypt.compare(next, row.password_hash));
  assert.equal(await bcrypt.compare(user.password, row.password_hash), false);
  await c.agent.get("/api/me").expect(401);
  await c.csrf();
  assert.equal(
    (
      await c.call("post", "/auth/login", {
        username: "reset-member",
        password: next,
      })
    ).status,
    200,
  );
  assert.equal(
    f.inspect(
      "SELECT COUNT(*) AS count FROM audit_logs WHERE action='password.reset'",
    )[0].count,
    1,
  );
  for (const secret of [user.password, next, row.password_hash])
    assert.ok(!`${result.stdout}${result.stderr}`.includes(secret));
  const log = JSON.parse(result.stdout.trim());
  assert.equal(log.event, "password.reset");
  assert.equal(log.service, "recipebox");
  assert.ok(log.request_id);
});

test("one audit helper commits related events together and emits none on rollback", async (t) => {
  const f = await fixture(t),
    c = f.client();
  const user = await c.register();
  const log = [];
  const audit = auditHelper(f.data, (level, event) => log.push(event));
  const req = { requestId: "test-request", user };
  assert.throws(
    () =>
      audit(req, "box.created", "box", null, "Test mutation", (record) => {
        f.data.createBox({ name: "Rolled back", description: "" }, user.id);
        record("test.secondary", "box", null, "Test secondary");
        throw new Error("Abort transaction");
      }),
    /Abort transaction/,
  );
  assert.equal(f.data.boxes().length, 0);
  assert.deepEqual(log, []);
  assert.equal(
    f.inspect(
      "SELECT COUNT(*) AS count FROM audit_logs WHERE action='test.secondary'",
    )[0].count,
    0,
  );
});

test("JSON logger includes stable fields and a null request ID outside requests", () => {
  const rows = [];
  const log = createLogger((row) => rows.push(row));
  log("info", "service.started");
  log("info", "test.event", { request_id: "request", user_id: 1 });
  assert.equal(rows[0].service, "recipebox");
  assert.equal(rows[0].request_id, null);
  assert.equal(rows[0].level, "info");
  assert.match(rows[0].timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(rows[1].request_id, "request");
  assert.equal(rows[1].user_id, 1);
});

test("disabled registration also blocks an empty installation", async (t) => {
  const f = await fixture(t, { registration: false });
  const c = f.client();
  const config = await c.agent.get("/auth/config");
  assert.equal(config.body.allow_registration, false);
  assert.equal(
    (
      await c.call("post", "/auth/register", {
        username: "first",
        display_name: "Test",
        password: password(),
      })
    ).status,
    403,
  );
  assert.equal(f.inspect("SELECT COUNT(*) AS count FROM users")[0].count, 0);
});

test("invalid JSON retains the authenticated user in request logs", async (t) => {
  const f = await fixture(t),
    c = f.client();
  const user = await c.register();
  const token = await c.csrf();
  const response = await c.agent
    .post("/api/recipes")
    .set("Content-Type", "application/json")
    .set("Origin", f.config.publicUrl)
    .set("X-CSRF-Token", token)
    .send("{")
    .expect(400);
  assert.equal(response.body.message, "Invalid JSON");
  assert.ok(response.body.request_id);
  const log = f.entries.find(
    (entry) =>
      entry.event === "http.request" &&
      entry.request_id === response.body.request_id,
  );
  assert.equal(log.user_id, user.id);
});
