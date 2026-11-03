import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fixture, sampleRecipe } from "./helpers.js";
import { openData } from "../server/db.js";
const tagValue = () => randomBytes(8).toString("hex");

test("tags normalize, validate, search and filter exactly; only the recipe author may edit them", async (t) => {
  const f = await fixture(t),
    a = f.client(),
    b = f.client();
  const author = await a.register("author");
  await b.register("other");
  const tag = tagValue(),
    second = tagValue();
  const input = {
    ...sampleRecipe(),
    tags: [` ${tag.toUpperCase()} `, tag, " ", second],
  };
  let response = await a.call("post", "/api/recipes", input);
  assert.equal(response.status, 201);
  const recipe = response.body;
  assert.deepEqual(recipe.tags, [tag, second]);
  for (const query of [tag.toUpperCase(), tag.slice(2, 8)]) {
    const found = await b.call(
      "get",
      `/api/recipes?q=${encodeURIComponent(query)}`,
    );
    assert.equal(found.status, 200);
    assert.deepEqual(
      found.body.map((r) => r.id),
      [recipe.id],
    );
    assert.deepEqual(found.body[0].tags, [tag, second]);
  }
  const titleOnly = (
    await a.call("post", "/api/recipes", { ...sampleRecipe(), title: tag })
  ).body;
  assert.deepEqual(
    (await b.call("get", `/api/recipes?tag=${tag.toUpperCase()}`)).body.map(
      (r) => r.id,
    ),
    [recipe.id],
  );
  assert.equal(
    (await b.call("get", `/api/recipes?tag=${tag.slice(0, 8)}`)).body.length,
    0,
  );
  const box = (await b.call("post", "/api/boxes", { name: "Test box" })).body;
  await b.call("post", `/api/boxes/${box.id}/recipes`, {
    recipe_id: recipe.id,
  });
  assert.deepEqual(
    (
      await b.call("get", `/api/recipes?q=${tag}&tag=${tag}&box_id=${box.id}`)
    ).body.map((r) => r.id),
    [recipe.id],
  );
  assert.equal(
    (await b.call("put", `/api/recipes/${recipe.id}`, { ...input, tags: [] }))
      .status,
    403,
  );
  assert.deepEqual(
    (await a.call("get", `/api/recipes/${recipe.id}`)).body.tags,
    [tag, second],
  );
  for (const tags of [
    Array.from({ length: 11 }, tagValue),
    [tagValue().repeat(2)],
    ["<b>" + tag + "</b>"],
    ["<!--" + tag + "-->"],
    "invalid",
  ]) {
    assert.equal(
      (await a.call("post", "/api/recipes", { ...sampleRecipe(), tags }))
        .status,
      400,
    );
    assert.equal(
      (await a.call("put", `/api/recipes/${recipe.id}`, { ...input, tags }))
        .status,
      400,
    );
  }
  const ten = Array.from({ length: 10 }, tagValue);
  ten[0] = randomBytes(15).toString("hex");
  assert.equal(
    (
      await a.call("put", `/api/recipes/${recipe.id}`, {
        ...input,
        tags: [...ten, ten[0].toUpperCase()],
      })
    ).status,
    200,
  );
  assert.deepEqual(
    (await a.call("put", `/api/recipes/${recipe.id}`, { ...input, tags: [] }))
      .body.tags,
    [],
  );
  assert.equal((await b.call("get", `/api/recipes?tag=${tag}`)).body.length, 0);
  for (const path of [
    "/api/recipes?tag=",
    "/api/recipes?tag=" + encodeURIComponent("<b>x</b>"),
    "/api/recipes?tag=a&tag=b",
  ])
    assert.equal((await b.call("get", path)).status, 400);
  const wildcard = tagValue() + "_%";
  await a.call("put", `/api/recipes/${recipe.id}`, {
    ...input,
    tags: [wildcard],
  });
  assert.deepEqual(
    (
      await b.call("get", `/api/recipes?q=${encodeURIComponent(wildcard)}`)
    ).body.map((r) => r.id),
    [recipe.id],
  );
  const audit = f.inspect(
    "SELECT * FROM audit_logs WHERE action='recipe.updated' AND entity_id=?",
    String(recipe.id),
  );
  assert.ok(audit.length >= 3);
  assert.ok(audit.every((row) => row.actor_id === author.id));
  assert.ok(!JSON.stringify(f.entries).includes(wildcard));
  await a.call("delete", `/api/recipes/${recipe.id}`);
  assert.equal(f.inspect("SELECT * FROM recipe_tags").length, 0);
  assert.equal(
    (await a.call("get", `/api/recipes/${titleOnly.id}`)).status,
    200,
  );
});

test("servings are optional, preserve ingredient text, and accept only positive integers when supplied", async (t) => {
  const f = await fixture(t),
    a = f.client();
  await a.register();
  const input = sampleRecipe();
  delete input.servings;
  input.ingredients[0].quantity = "1.50";
  let r = await a.call("post", "/api/recipes", input);
  assert.equal(r.status, 201);
  const id = r.body.id;
  assert.equal(r.body.servings, null);
  assert.deepEqual(r.body.tags, []);
  assert.equal(r.body.ingredients[0].quantity, "1.50");
  assert.equal(
    (await a.call("put", `/api/recipes/${id}`, { ...input, servings: 4 })).body
      .servings,
    4,
  );
  assert.equal(
    (await a.call("put", `/api/recipes/${id}`, { ...input, servings: null }))
      .body.servings,
    null,
  );
  for (const servings of [0, -1, 0.01, 4.01, 4.5, 10001, "", "4"]) {
    assert.equal(
      (await a.call("post", "/api/recipes", { ...input, servings })).status,
      400,
    );
    assert.equal(
      (await a.call("put", `/api/recipes/${id}`, { ...input, servings }))
        .status,
      400,
    );
  }
  assert.equal((await a.call("get", `/api/recipes/${id}`)).body.servings, null);
});

test("v2 migration preserves servings and all related rows, covers, audit records and sessions", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "recipebox-v2-migration-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let data = openData(dir);
  const user = data.createLocal(
    { username: "member", display_name: "Test Member" },
    "test-only-hash",
  );
  const first = data.createRecipe(sampleRecipe(), user.id),
    fractional = data.createRecipe(
      { ...sampleRecipe(), servings: 3.5 },
      user.id,
    );
  const box = data.createBox({ name: "Test box", description: "" }, user.id);
  data.addRecipeBox(box, first);
  const photo = data.createPhoto(first, "test.webp", "test.png", user.id);
  data.cover(first, photo);
  data.createComment(first, user.id, "Migration comment");
  data.audit(user, "recipe.created", "recipe", first, "Recipe created");
  data.sessionStore.set("test-session", {
    cookie: { expires: new Date(Date.now() + 60000) },
    userId: user.id,
    authMode: "local",
  });
  data.close();
  let sql = new DatabaseSync(join(dir, "recipebox.db"));
  sql.exec(`PRAGMA foreign_keys=OFF; BEGIN;
 CREATE TABLE recipes_v2 (
 id INTEGER PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',servings REAL NOT NULL,
 prep_minutes INTEGER,cook_minutes INTEGER,source TEXT NOT NULL DEFAULT '',author_id INTEGER NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 manual_cover_photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL);
 INSERT INTO recipes_v2 SELECT * FROM recipes; DROP TABLE recipe_tags; DROP TABLE recipes;
 ALTER TABLE recipes_v2 RENAME TO recipes; PRAGMA user_version=2; COMMIT;`);
  const tables = [
    "users",
    "recipes",
    "ingredients",
    "steps",
    "boxes",
    "recipe_boxes",
    "photos",
    "comments",
    "audit_logs",
    "sessions",
  ];
  const digest = (db, table) =>
    createHash("sha256")
      .update(
        JSON.stringify(
          db.prepare("SELECT * FROM " + table + " ORDER BY rowid").all(),
        ),
      )
      .digest("hex");
  const before = Object.fromEntries(
    tables.map((table) => [table, digest(sql, table)]),
  );
  sql.close();
  data = openData(dir);
  assert.equal(data.recipe(first).servings, 4);
  assert.equal(data.recipe(fractional).servings, 3.5);
  assert.equal(data.recipe(first).manual_cover_photo_id, photo);
  assert.deepEqual(data.recipe(first).tags, []);
  data.close();
  sql = new DatabaseSync(join(dir, "recipebox.db"));
  assert.deepEqual(
    Object.fromEntries(tables.map((table) => [table, digest(sql, table)])),
    before,
  );
  assert.equal(sql.prepare("PRAGMA user_version").get().user_version, 3);
  assert.deepEqual(sql.prepare("PRAGMA foreign_key_check").all(), []);
  sql.close();
  data = openData(dir);
  try {
    assert.equal(data.recipe(first).servings, 4);
    const optional = data.createRecipe(
      { ...sampleRecipe(), servings: null },
      user.id,
    );
    assert.equal(data.recipe(optional).servings, null);
    data.deleteRecipe(first);
    assert.equal(data.photo(photo), null);
    assert.equal(data.box(box).id, box);
  } finally {
    data.close();
  }
});
