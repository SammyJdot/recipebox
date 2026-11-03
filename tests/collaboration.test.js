import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import request from "supertest";
import { openData } from "../server/db.js";
import { fixture, sampleRecipe } from "./helpers.js";

async function group(t) {
  const f = await fixture(t);
  const a = f.client(),
    b = f.client(),
    c = f.client();
  const users = await Promise.all([
    a.register("author"),
    b.register("uploader"),
    c.register("other"),
  ]);
  const recipe = (await a.call("post", "/api/recipes", sampleRecipe())).body;
  return { ...f, a, b, c, users, recipe };
}

test("comments validate plain text and enforce author edit / author-or-recipe-author delete on the server", async (t) => {
  const f = await group(t),
    path = `/api/recipes/${f.recipe.id}/comments`;
  await request(f.app).post(path).send({ text: "Denied" }).expect(401);
  for (const text of [
    "",
    " \n ",
    "x".repeat(2001),
    "<script>alert(1)</script>",
    '<img src=x onerror="alert(1)">',
    "<!-- hidden -->",
  ]) {
    assert.equal((await f.b.call("post", path, { text })).status, 400);
  }
  assert.equal(
    (await f.b.call("post", path, { text: "ok", author_id: f.users[0].id }))
      .status,
    400,
  );
  const boundary = await f.b.call("post", path, { text: "x".repeat(2000) });
  assert.equal(boundary.status, 201);
  assert.equal(
    (await f.b.call("delete", `/api/comments/${boundary.body.id}`)).status,
    204,
  );
  const text = "Use < 2 cups & stir.\n&lt;script&gt; stays literal.";
  const created = await f.b.call("post", path, { text });
  assert.equal(created.status, 201);
  const comment = created.body;
  assert.equal(comment.author_id, f.users[1].id);
  assert.equal(comment.author_name, f.users[1].display_name);
  assert.ok(comment.created_at);
  assert.equal(comment.text, text);
  for (const client of [f.a, f.c]) {
    assert.equal(
      (
        await client.call("put", `/api/comments/${comment.id}`, {
          text: "Forbidden",
        })
      ).status,
      403,
    );
  }
  assert.equal(
    (await f.c.call("delete", `/api/comments/${comment.id}`)).status,
    403,
  );
  assert.equal(
    (
      await f.b.call("put", `/api/comments/${comment.id}`, {
        text: "<b>Invalid</b>",
      })
    ).status,
    400,
  );
  assert.equal(
    (await f.b.call("get", `/api/recipes/${f.recipe.id}`)).body.comments[0]
      .text,
    text,
  );
  const changed = await f.b.call("put", `/api/comments/${comment.id}`, {
    text: "Edited plain text",
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.text, "Edited plain text");
  const second = (await f.a.call("post", path, { text: "Second comment" }))
    .body;
  const comments = (await f.c.call("get", `/api/recipes/${f.recipe.id}`)).body
    .comments;
  assert.deepEqual(
    comments.map((c) => c.id),
    [comment.id, second.id],
  );
  assert.equal(
    (await f.a.call("delete", `/api/comments/${comment.id}`)).status,
    204,
  );
  assert.equal(
    (await f.b.call("put", `/api/comments/${comment.id}`, { text: "Gone" }))
      .status,
    404,
  );
  await f.a.call("delete", `/api/recipes/${f.recipe.id}`);
  assert.equal(f.inspect("SELECT * FROM comments").length, 0);
  for (const action of [
    "comment.created",
    "comment.updated",
    "comment.deleted",
  ]) {
    const rows = f.inspect("SELECT * FROM audit_logs WHERE action=?", action);
    assert.ok(rows.length);
    assert.ok(
      rows.every(
        (row) =>
          row.actor_id &&
          row.entity_id &&
          row.detail.includes(`Recipe ${f.recipe.id}`),
      ),
    );
    assert.ok(
      f.entries.some((e) => e.event === action && e.request_id && e.user_id),
    );
  }
  assert.ok(!JSON.stringify(f.entries).includes("Edited plain text"));
});

test("any user can upload; delete permissions, dynamic covers and manual overrides apply to every recipe list", async (t) => {
  const f = await group(t),
    id = f.recipe.id;
  const box = (await f.a.call("post", "/api/boxes", { name: "Test box" })).body;
  await f.b.call("post", `/api/boxes/${box.id}/recipes`, { recipe_id: id });
  const image = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#789" },
  })
    .jpeg()
    .withExif({
      IFD0: { Artist: "Metadata test" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "12/1 34/1 56/1",
        GPSLongitudeRef: "W",
        GPSLongitude: "65/1 43/1 21/1",
      },
    })
    .toBuffer();
  const exif = (await sharp(image).metadata()).exif;
  assert.ok(exif);
  const tiff = exif.subarray(6);
  const little = tiff.toString("ascii", 0, 2) === "II";
  const u16 = (offset) =>
    little ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset);
  const u32 = (offset) =>
    little ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset);
  const tags = (offset) =>
    Array.from({ length: u16(offset) }, (_, index) => ({
      tag: u16(offset + 2 + 12 * index),
      value: u32(offset + 10 + 12 * index),
    }));
  const gps = tags(u32(4)).find((entry) => entry.tag === 0x8825);
  assert.ok(gps, "Fixture must contain a GPS IFD");
  assert.deepEqual(
    tags(gps.value).map((entry) => entry.tag),
    [1, 2, 3, 4],
  );
  const upload = async (client) => {
    const csrf = await client.csrf();
    const response = await client.agent
      .post(`/api/recipes/${id}/photos`)
      .set("Origin", f.config.publicUrl)
      .set("X-CSRF-Token", csrf)
      .attach("photo", image, {
        filename: "test.jpg",
        contentType: "image/jpeg",
      });
    assert.equal(response.status, 201);
    return response.body;
  };
  const check = async (expected, manual = null) => {
    const r = (await f.c.call("get", `/api/recipes/${id}`)).body;
    assert.equal(
      r.photos.find((p) => p.is_cover)?.id ?? null,
      expected?.id ?? null,
    );
    assert.equal(r.manual_cover_photo_id, manual);
    for (const path of [
      "/api/recipes",
      "/api/recipes?q=bread",
      "/api/recipes?q=flour",
      `/api/recipes?box_id=${box.id}`,
      `/api/recipes?q=flour&box_id=${box.id}`,
    ]) {
      const listed = (await f.c.call("get", path)).body.find(
        (r) => r.id === id,
      );
      assert.equal(listed.thumbnail_url, expected?.thumbnail_url ?? null, path);
    }
    return r;
  };
  await check(null);
  const b1 = await upload(f.b),
    c1 = await upload(f.c);
  await check(b1);
  for (const url of [b1.url, b1.thumbnail_url]) {
    await request(f.app).get(url).expect(401);
    const served = await f.c.agent.get(url).expect(200);
    const metadata = await sharp(served.body).metadata();
    for (const field of ["exif", "xmp", "iptc", "icc"])
      assert.equal(metadata[field], undefined);
  }
  const a1 = await upload(f.a),
    a2 = await upload(f.a);
  const detail = await check(a1);
  assert.deepEqual(
    detail.photos.map((p) => p.id),
    [b1.id, c1.id, a1.id, a2.id],
  );
  assert.ok(detail.photos.every((p) => p.uploader_name && p.created_at));
  for (const client of [f.b, f.c]) {
    assert.equal(
      (
        await client.call("put", `/api/recipes/${id}`, {
          cover_photo_id: b1.id,
        })
      ).status,
      403,
    );
    assert.equal(
      (await client.call("put", `/api/recipes/${id}`, { cover_photo_id: null }))
        .status,
      403,
    );
  }
  assert.equal((await f.c.call("delete", `/api/photos/${b1.id}`)).status, 403);
  await check(a1);
  assert.equal((await f.a.call("delete", `/api/photos/${a1.id}`)).status, 204);
  await check(a2);
  assert.equal(
    (await f.a.call("put", `/api/recipes/${id}`, { cover_photo_id: b1.id }))
      .status,
    200,
  );
  await check(b1, b1.id);
  const a3 = await upload(f.a);
  await check(b1, b1.id);
  assert.equal(
    (await f.a.call("put", `/api/recipes/${id}`, { cover_photo_id: c1.id }))
      .status,
    200,
  );
  await check(c1, c1.id);
  assert.equal(
    (await f.a.call("put", `/api/recipes/${id}`, { cover_photo_id: null }))
      .status,
    200,
  );
  await check(a2);
  await f.a.call("put", `/api/recipes/${id}`, { cover_photo_id: b1.id });
  assert.equal((await f.b.call("delete", `/api/photos/${b1.id}`)).status, 204);
  await check(a2);
  assert.equal((await f.a.call("delete", `/api/photos/${a2.id}`)).status, 204);
  await check(a3);
  assert.equal((await f.a.call("delete", `/api/photos/${a3.id}`)).status, 204);
  await check(c1);
  // Recipe author can delete another uploader's photo.
  assert.equal((await f.a.call("delete", `/api/photos/${c1.id}`)).status, 204);
  await check(null);
  const foreignRecipe = (await f.a.call("post", "/api/recipes", sampleRecipe()))
    .body;
  const surviving = await upload(f.b);
  assert.equal(
    (
      await f.a.call("put", `/api/recipes/${foreignRecipe.id}`, {
        cover_photo_id: surviving.id,
      })
    ).status,
    400,
  );
  await f.b.call("post", `/api/recipes/${id}/comments`, {
    text: "Removed with recipe",
  });
  await f.a.call("put", `/api/recipes/${id}`, { cover_photo_id: surviving.id });
  assert.equal((await f.a.call("delete", `/api/recipes/${id}`)).status, 204);
  assert.equal(
    f.inspect("SELECT * FROM photos WHERE recipe_id=?", id).length,
    0,
  );
  assert.equal(
    f.inspect("SELECT * FROM comments WHERE recipe_id=?", id).length,
    0,
  );
  for (const action of [
    "cover.set",
    "cover.cleared",
    "photo.uploaded",
    "photo.deleted",
  ]) {
    assert.ok(
      f.inspect("SELECT * FROM audit_logs WHERE action=?", action).length,
    );
    assert.ok(
      f.entries.some((e) => e.event === action && e.request_id && e.user_id),
    );
  }
  const uploadAudit = f.inspect(
    "SELECT * FROM audit_logs WHERE action='photo.uploaded' AND entity_id=?",
    String(b1.id),
  )[0];
  assert.equal(uploadAudit.actor_id, f.users[1].id);
  assert.ok(uploadAudit.detail.includes(`uploader ${f.users[1].id}`));
});

test("v1 migration preserves the selected cover and recipe data across restarts", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "recipebox-migration-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let data = openData(dir);
  const user = data.createLocal(
    { username: "member", display_name: "Test Member" },
    "test-only-hash",
  );
  const id = data.createRecipe(sampleRecipe(), user.id);
  data.createPhoto(id, "one.webp", "one.png", user.id);
  const coverId = data.createPhoto(id, "two.webp", "two.png", user.id);
  data.cover(id, coverId);
  data.close();
  // Remove only v2 additions to recreate the on-disk v1 schema.
  const db = new DatabaseSync(join(dir, "recipebox.db"));
  db.exec(
    "DROP TABLE comments; ALTER TABLE recipes DROP COLUMN manual_cover_photo_id; PRAGMA user_version=1;",
  );
  db.close();
  data = openData(dir);
  assert.equal(data.recipe(id).manual_cover_photo_id, coverId);
  assert.equal(data.recipe(id).photos.find((p) => p.is_cover).id, coverId);
  assert.deepEqual(
    data.recipe(id).ingredients.map((i) => ({ ...i })),
    sampleRecipe().ingredients,
  );
  const commentId = data.createComment(id, user.id, "Persisted comment");
  data.close();
  data = openData(dir);
  try {
    assert.equal(data.recipe(id).manual_cover_photo_id, coverId);
    assert.equal(data.recipe(id).comments[0].id, commentId);
  } finally {
    data.close();
  }
});
