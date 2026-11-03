import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import sharp from "sharp";
const name = `recipebox-check-${randomBytes(5).toString("hex")}`;
const env = {
  ...process.env,
  COMPOSE_PROJECT_NAME: name,
  RECIPEBOX_IMAGE: "recipebox:ci",
  PUBLIC_URL: "http://localhost:31877",
  HOST_PORT: "31877",
  AUTH_MODE: "local",
  SESSION_SECRET: randomBytes(32).toString("hex"),
  ALLOW_LOCAL_REGISTRATION: "true",
  APP_VERSION: "ci",
};
function docker(args, capture = false) {
  const result = spawnSync("docker", args, {
    env,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0) throw new Error(`Docker check failed: ${args[0]}`);
  return result.stdout?.trim();
}
const base = env.PUBLIC_URL;
function client() {
  let cookie, csrf;
  return async (path, method = "GET", body) => {
    const form = body instanceof FormData;
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        Origin: base,
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        ...(body && !form ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? (form ? body : JSON.stringify(body)) : undefined,
    });
    const next = res.headers.getSetCookie();
    if (next.length) cookie = next.at(-1).split(";")[0];
    const image = res.headers.get("content-type")?.startsWith("image/");
    const value =
      res.status === 204
        ? null
        : image
          ? Buffer.from(await res.arrayBuffer())
          : await res.json();
    if (value?.csrf_token) csrf = value.csrf_token;
    assert.ok(res.headers.get("x-request-id"));
    return { status: res.status, body: value };
  };
}
try {
  docker(["compose", "up", "-d", "--wait", "--wait-timeout", "90"]);
  const a = client(),
    b = client();
  assert.equal((await a("/health")).body.ok, true);
  assert.equal((await a("/api/me")).status, 401);
  await a("/auth/config");
  await b("/auth/config");
  const secret = randomBytes(20).toString("hex");
  const admin = await a("/auth/register", "POST", {
    username: "test-admin",
    password: secret,
    display_name: "Test Member",
  });
  assert.equal(admin.status, 201);
  assert.equal(admin.body.user.role, "admin");
  const member = await b("/auth/register", "POST", {
    username: "test-member",
    password: randomBytes(20).toString("hex"),
    display_name: "Test Member",
  });
  assert.equal(member.body.user.role, "member");
  assert.equal((await a("/api/boxes")).body.length, 0);
  assert.equal((await a("/api/recipes")).body.length, 0);
  assert.equal((await a("/auth/oidc")).status, 404);
  const input = {
    title: "Container bread",
    description: "Private recipe description",
    servings: 4,
    ingredients: [{ quantity: "1 1/2", unit: "cups", item: "flour", note: "" }],
    steps: [{ text: "Mix and cook." }],
    source: "",
    prep_minutes: 10,
    cook_minutes: 20,
  };
  const created = await a("/api/recipes", "POST", input);
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal((await b(`/api/recipes/${id}`, "PUT", input)).status, 403);
  assert.equal((await b(`/api/recipes/${id}`, "DELETE")).status, 403);
  assert.equal(
    (
      await a(`/api/recipes/${id}`, "PUT", {
        ...input,
        title: "Updated container bread",
      })
    ).status,
    200,
  );
  const one = (await a("/api/boxes", "POST", { name: "Persistence test" }))
    .body;
  const two = (await b("/api/boxes", "POST", { name: "Second box" })).body;
  assert.equal(
    (await b(`/api/boxes/${one.id}`, "PUT", { name: "Forbidden" })).status,
    403,
  );
  assert.equal(
    (await a(`/api/boxes/${one.id}`, "PUT", { name: "Renamed box" })).status,
    200,
  );
  for (const box of [one, two])
    assert.equal(
      (await b(`/api/boxes/${box.id}/recipes`, "POST", { recipe_id: id }))
        .status,
      204,
    );
  assert.equal((await a(`/api/recipes/${id}`)).body.boxes.length, 2);
  assert.equal(
    (await b(`/api/boxes/${one.id}/recipes/${id}`, "DELETE")).status,
    204,
  );
  assert.deepEqual(
    (await a(`/api/recipes/${id}`)).body.boxes.map((x) => x.id),
    [two.id],
  );
  for (const q of ["bread", "flour"])
    assert.equal(
      (await a(`/api/recipes?q=${q}&box_id=${two.id}`)).body[0].id,
      id,
    );
  assert.equal(
    (await a(`/api/recipes?q=flour&box_id=${one.id}`)).body.length,
    0,
  );
  const image = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#abc" },
  })
    .png()
    .toBuffer();
  async function upload(call, buffer = image) {
    const form = new FormData();
    form.append("photo", new Blob([buffer], { type: "image/png" }), "test.png");
    return call(`/api/recipes/${id}/photos`, "POST", form);
  }
  assert.equal((await upload(b)).status, 403);
  assert.equal(
    (await upload(a, Buffer.alloc(10 * 1024 * 1024 + 1))).status,
    413,
  );
  const p1 = await upload(a);
  assert.equal(p1.status, 201);
  const p2 = await upload(a);
  assert.equal(p2.status, 201);
  assert.equal(
    (await sharp((await a(p1.body.thumbnail_url)).body).metadata()).width,
    480,
  );
  assert.equal(
    (await a(`/api/recipes/${id}`, "PUT", { cover_photo_id: p2.body.id }))
      .status,
    200,
  );
  assert.equal(
    (await a(`/api/recipes/${id}`)).body.photos.find((p) => p.is_cover).id,
    p2.body.id,
  );
  assert.equal((await a(`/api/photos/${p2.body.id}`, "DELETE")).status, 204);
  assert.equal((await b(`/api/boxes/${two.id}`, "DELETE")).status, 204);
  assert.equal((await a(`/api/recipes/${id}`)).status, 200);
  assert.equal((await a(`/api/recipes/${id}`, "DELETE")).status, 204);
  docker(["compose", "restart"]);
  for (let i = 0; i < 30; i++) {
    try {
      if ((await a("/health")).status === 200) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal((await a("/api/boxes")).body[0].id, one.id);
  assert.equal((await a(`/api/boxes/${one.id}`, "DELETE")).status, 204);
  // Inspect persisted hashes and audit events without printing hashes or credentials.
  docker([
    "compose",
    "exec",
    "-T",
    "recipebox",
    "node",
    "--input-type=module",
    "-e",
    `
    import {DatabaseSync} from 'node:sqlite'; import assert from 'node:assert/strict';
    const db=new DatabaseSync('/data/recipebox.db');
    for(const u of db.prepare('SELECT password_hash FROM users').all()) assert.match(u.password_hash,/^\\$2[aby]\\$12\\$/);
    for(const action of ['recipe.created','recipe.updated','recipe.deleted','photo.uploaded','photo.deleted']) assert.ok(db.prepare('SELECT 1 FROM audit_logs WHERE action=?').get(action));
    db.close();
  `,
  ]);
  const browser = spawnSync("npm", ["run", "test:browser"], {
    env: { ...env, RECIPEBOX_TEST_URL: base },
    stdio: "inherit",
  });
  assert.equal(
    browser.status,
    0,
    "Browser acceptance must pass against the running Docker image",
  );
  const logs = docker(["compose", "logs", "--no-color"], true);
  assert.ok(logs.includes('"request_id"'));
  assert.ok(logs.includes('"box.created"'));
  for (const value of [env.SESSION_SECRET, secret, input.description])
    assert.ok(!logs.includes(value));
  docker([
    "compose",
    "exec",
    "-T",
    "recipebox",
    "node",
    "--input-type=module",
    "-e",
    `import {existsSync} from 'node:fs'; for(const p of ['/app/.env','/app/.git','/app/tests','/app/docs','/app/web','/app/recipebox.db','/app/node_modules/@playwright/test/package.json','/app/node_modules/playwright/package.json','/app/node_modules/vite/package.json']) if(existsSync(p)) { console.error('Unexpected development artifact: '+p); process.exit(1); }`,
  ]);
  console.log(
    "Docker acceptance passed: authentication, permissions, recipes, boxes, photos, search, scaling, print, logs, audits and restart persistence.",
  );
} finally {
  docker(["compose", "down", "--volumes", "--remove-orphans"]);
}
