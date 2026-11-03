import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { fixture, sampleRecipe, password } from "./helpers.js";
import { createApp } from "../server/app.js";
import { requireAdmin } from "../server/logging.js";

test("fresh install is empty; health is public; all API routes require login and request IDs", async (t) => {
  const f = await fixture(t);
  const health = await request(f.app).get("/health").expect(200);
  assert.deepEqual(health.body, { ok: true, database: "ok", version: "test" });
  for (const table of [
    "users",
    "recipes",
    "boxes",
    "comments",
    "photos",
    "audit_logs",
  ])
    assert.equal(
      f.inspect(`SELECT COUNT(*) AS count FROM ${table}`)[0].count,
      0,
    );
  for (const path of [
    "/api/me",
    "/api/recipes",
    "/api/boxes",
    "/api/missing",
  ]) {
    const res = await request(f.app).get(path).expect(401);
    assert.ok(res.headers["x-request-id"]);
    assert.equal(res.body.request_id, res.headers["x-request-id"]);
  }
});

test("registration, hash, role assignment, case-insensitive uniqueness and session cookie", async (t) => {
  const f = await fixture(t);
  const first = f.client();
  const admin = await first.register("first");
  assert.equal(admin.role, "admin");
  const stored = f.inspect("SELECT * FROM users WHERE id=?", admin.id)[0];
  assert.notEqual(stored.password_hash, admin.password);
  assert.match(stored.password_hash, /^\$2[aby]\$12\$/);
  assert.ok(await bcrypt.compare(admin.password, stored.password_hash));
  assert.ok(stored.last_login_at);
  const cookie = admin.response.headers["set-cookie"].join(";");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.ok(!JSON.stringify(admin.response.body).includes("password_hash"));
  const second = f.client();
  assert.equal((await second.register("second")).role, "member");
  await f
    .client()
    .call("post", "/auth/register", {
      username: "FIRST",
      password: password(),
      display_name: "Test",
    })
    .then((r) => assert.equal(r.status, 409));
  await first
    .call("post", "/auth/logout")
    .then((r) => assert.equal(r.status, 204));
  await first.agent.get("/api/me").expect(401);
  await first.csrf();
  await first
    .call("post", "/auth/login", { username: "first", password: password() })
    .then((r) => assert.equal(r.status, 401));
  const login = await first.call("post", "/auth/login", {
    username: "FIRST",
    password: admin.password,
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.id, admin.id);
  assert.ok(f.entries.some((e) => e.event === "login.failure"));
  assert.ok(!JSON.stringify(f.entries).includes(admin.password));
});

test("registration disabled and inactive auth routes cannot log in; mode changes invalidate sessions", async (t) => {
  const f = await fixture(t);
  const c = f.client();
  const user = await c.register();
  await c.agent.get("/auth/oidc").expect(404);
  const localDisabled = createApp(
    { ...f.config, registration: false },
    { data: f.data, log: () => {} },
  ).app;
  const agent = request.agent(localDisabled);
  const csrf = (await agent.get("/auth/config")).body.csrf_token;
  await agent
    .post("/auth/register")
    .set("Origin", f.config.publicUrl)
    .set("X-CSRF-Token", csrf)
    .send({ username: "another", password: password(), display_name: "Test" })
    .expect(403);
  await agent
    .post("/auth/login")
    .set("Origin", f.config.publicUrl)
    .set("X-CSRF-Token", csrf)
    .send({ username: "member", password: user.password })
    .expect(200);
  const oidc = createApp(
    {
      ...f.config,
      authMode: "oidc",
      oidc: {
        issuer: "https://provider.invalid",
        clientId: "test",
        clientSecret: password(),
        redirectUri: "http://localhost/auth/oidc/callback",
      },
    },
    { data: f.data, log: () => {} },
  ).app;
  const cookie = user.response.headers["set-cookie"];
  await request(oidc).get("/api/me").set("Cookie", cookie).expect(401);
  const o = request.agent(oidc);
  const token = (await o.get("/auth/config")).body.csrf_token;
  for (const path of ["/auth/login", "/auth/register"])
    await o
      .post(path)
      .set("Origin", f.config.publicUrl)
      .set("X-CSRF-Token", token)
      .send({ username: "member", password: user.password })
      .expect(404);
});

test("CSRF and input validation reject unsafe writes", async (t) => {
  const f = await fixture(t);
  const c = f.client();
  await c.register();
  await c.agent.post("/api/boxes").send({ name: "Test" }).expect(403);
  const csrf = await c.csrf();
  await c.agent
    .post("/api/boxes")
    .set("X-CSRF-Token", csrf)
    .set("Origin", "https://other.invalid")
    .send({ name: "Test" })
    .expect(403);
  for (const body of [
    { ...sampleRecipe(), author_id: 999 },
    { ...sampleRecipe(), servings: 0 },
    { ...sampleRecipe(), ingredients: [] },
    { ...sampleRecipe(), steps: [{ text: "" }] },
  ])
    assert.equal((await c.call("post", "/api/recipes", body)).status, 400);
  assert.equal((await c.call("post", "/api/boxes", { name: " " })).status, 400);
  await c.agent.get("/api/recipes/0").expect(400);
  await c.agent.get("/api/recipes?box_id=abc").expect(400);
});

test("author CRUD, member cannot edit/delete, multi-box operations and retained recipes", async (t) => {
  const f = await fixture(t);
  const a = f.client(),
    b = f.client();
  const author = await a.register("author");
  await b.register("other");
  const created = await a.call("post", "/api/recipes", sampleRecipe());
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal(created.body.author_id, author.id);
  assert.equal(
    (await b.call("put", `/api/recipes/${id}`, sampleRecipe())).status,
    403,
  );
  assert.equal((await b.call("delete", `/api/recipes/${id}`)).status, 403);
  const updated = await a.call("put", `/api/recipes/${id}`, {
    ...sampleRecipe(),
    title: "Updated bread",
    ingredients: [{ item: "rye", quantity: "1/2", unit: "cup", note: "" }],
  });
  assert.equal(updated.status, 200);
  const box1 = (await a.call("post", "/api/boxes", { name: "Box one" })).body;
  const box2 = (await b.call("post", "/api/boxes", { name: "Box two" })).body;
  assert.equal(
    (await b.call("put", `/api/boxes/${box1.id}`, { name: "Forbidden" }))
      .status,
    403,
  );
  assert.equal((await b.call("delete", `/api/boxes/${box1.id}`)).status, 403);
  assert.equal(
    (
      await a.call("put", `/api/boxes/${box1.id}`, {
        name: "Renamed",
        description: "Test",
      })
    ).status,
    200,
  );
  for (const box of [box1, box2])
    assert.equal(
      (await b.call("post", `/api/boxes/${box.id}/recipes`, { recipe_id: id }))
        .status,
      204,
    );
  assert.equal((await a.agent.get(`/api/recipes/${id}`)).body.boxes.length, 2);
  assert.equal(
    (await a.call("delete", `/api/boxes/${box1.id}/recipes/${id}`)).status,
    204,
  );
  assert.deepEqual(
    (await b.agent.get(`/api/recipes/${id}`)).body.boxes.map((x) => x.id),
    [box2.id],
  );
  assert.equal((await b.call("delete", `/api/boxes/${box2.id}`)).status, 204);
  await a.agent.get(`/api/recipes/${id}`).expect(200);
  assert.equal((await a.call("delete", `/api/recipes/${id}`)).status, 204);
  await a.agent.get(`/api/recipes/${id}`).expect(404);
  const events = f
    .inspect("SELECT action FROM audit_logs")
    .map((e) => e.action);
  for (const event of [
    "recipe.created",
    "recipe.updated",
    "recipe.deleted",
    "box.created",
    "box.renamed",
    "box.deleted",
    "recipe.box_added",
    "recipe.box_removed",
  ])
    assert.ok(events.includes(event), event);
});

test("search by title and ingredient with box filtering and literal wildcard handling", async (t) => {
  const f = await fixture(t);
  const c = f.client();
  await c.register();
  const r = (await c.call("post", "/api/recipes", sampleRecipe())).body;
  await c.call("post", "/api/recipes", {
    ...sampleRecipe(),
    title: "Other dish",
    ingredients: [{ item: "carrot", quantity: null }],
  });
  const b = (await c.call("post", "/api/boxes", { name: "Test box" })).body;
  await c.call("post", `/api/boxes/${b.id}/recipes`, { recipe_id: r.id });
  for (const q of ["bread", "FLOUR"]) {
    const result = await c.agent
      .get("/api/recipes")
      .query({ q, box_id: b.id })
      .expect(200);
    assert.deepEqual(
      result.body.map((x) => x.id),
      [r.id],
    );
  }
  assert.equal(
    (await c.agent.get("/api/recipes").query({ q: "carrot", box_id: b.id }))
      .body.length,
    0,
  );
  assert.equal(
    (await c.agent.get("/api/recipes").query({ q: "%" })).body.length,
    0,
  );
});

test("photo validation, thumbnails, author checks, cover selection and delete", async (t) => {
  const f = await fixture(t);
  const c = f.client(),
    other = f.client();
  await c.register("author");
  await other.register("other");
  const r = (await c.call("post", "/api/recipes", sampleRecipe())).body;
  const image = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#abc" },
  })
    .png()
    .toBuffer();
  const csrf = await c.csrf();
  const upload = (
    buffer,
    filename = "test.png",
    contentType = "image/png",
    client = c,
    token = csrf,
  ) =>
    client.agent
      .post(`/api/recipes/${r.id}/photos`)
      .set("Origin", f.config.publicUrl)
      .set("X-CSRF-Token", token)
      .attach("photo", buffer, { filename, contentType });
  const shared = (
    await upload(
      image,
      "test.png",
      "image/png",
      other,
      await other.csrf(),
    ).expect(201)
  ).body;
  assert.equal(
    (await other.call("delete", `/api/photos/${shared.id}`)).status,
    204,
  );
  await upload(Buffer.from("invalid")).expect(400);
  await upload(image, "test.svg", "image/svg+xml").expect(400);
  await upload(Buffer.alloc(10 * 1024 * 1024 + 1))
    .expect(413)
    .then((res) => assert.match(res.body.message, /10 MB/));
  const p1 = (await upload(image).expect(201)).body,
    p2 = (await upload(image).expect(201)).body;
  assert.equal(p1.is_cover, 1);
  assert.equal(p2.is_cover, 0);
  await request(f.app).get(p1.url).expect(401);
  await c.agent.get(p1.url).expect(200);
  const thumb = await c.agent.get(p1.thumbnail_url).expect(200);
  assert.equal((await sharp(thumb.body).metadata()).width, 480);
  assert.equal(
    (await other.call("put", `/api/recipes/${r.id}`, { cover_photo_id: p2.id }))
      .status,
    403,
  );
  assert.equal(
    (await c.call("put", `/api/recipes/${r.id}`, { cover_photo_id: p2.id }))
      .status,
    200,
  );
  assert.equal(
    (await c.agent.get(`/api/recipes/${r.id}`)).body.photos.find(
      (p) => p.is_cover,
    ).id,
    p2.id,
  );
  assert.equal(
    (await other.call("delete", `/api/photos/${p2.id}`)).status,
    403,
  );
  assert.equal((await c.call("delete", `/api/photos/${p2.id}`)).status, 204);
  await assert.rejects(access(join(f.dir, "uploads", p2.stored_filename)));
  assert.equal(
    (await c.agent.get(`/api/recipes/${r.id}`)).body.photos.find(
      (p) => p.is_cover,
    ).id,
    p1.id,
  );
  await c.call("delete", `/api/recipes/${r.id}`);
  await assert.rejects(access(join(f.dir, "uploads", p1.stored_filename)));
  assert.ok(
    f.inspect("SELECT * FROM audit_logs WHERE action='photo.deleted'")
      .length === 3,
  );
});

test("audit is append-only; JSON logs have request IDs and do not contain secrets or recipe bodies", async (t) => {
  const f = await fixture(t);
  const c = f.client();
  const member = await c.register();
  const body = {
    ...sampleRecipe(),
    description: password(),
    source: password(),
  };
  const r = (await c.call("post", "/api/recipes", body)).body;
  await c.call("put", `/api/recipes/${r.id}`, body);
  await c.call("delete", `/api/recipes/${r.id}`);
  const serialized = JSON.stringify(f.entries);
  for (const secret of [
    member.password,
    f.config.sessionSecret,
    body.description,
    body.source,
  ])
    assert.ok(!serialized.includes(secret));
  for (const event of ["recipe.created", "recipe.updated", "recipe.deleted"]) {
    const log = f.entries.find((e) => e.event === event);
    assert.ok(log.request_id);
    assert.equal(log.user_id, member.id);
  }
  assert.ok(
    f.entries
      .filter((e) => e.event === "http.request")
      .every((e) => e.request_id && e.method && Number.isInteger(e.status)),
  );
  assert.throws(
    () => f.inspect("UPDATE audit_logs SET detail='changed'"),
    /append-only/,
  );
  assert.throws(() => f.inspect("DELETE FROM audit_logs"), /append-only/);
});

test("admin foundation checks the shared role", () => {
  const response = {
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
    },
  };
  let reached = false;
  requireAdmin({ requestId: "test" }, response, () => {
    reached = true;
  });
  assert.equal(response.code, 401);
  requireAdmin(
    { user: { role: "member" }, requestId: "test" },
    response,
    () => {
      reached = true;
    },
  );
  assert.equal(response.code, 403);
  requireAdmin({ user: { role: "admin" } }, response, () => {
    reached = true;
  });
  assert.equal(reached, true);
});
