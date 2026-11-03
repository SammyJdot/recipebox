import { mkdtemp, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { createApp } from "../server/app.js";
import { DatabaseSync } from "node:sqlite";
export const password = () => randomBytes(20).toString("hex");
export const sampleRecipe = () => ({
  title: "Test bread",
  description: "A test recipe",
  servings: 4,
  prep_minutes: 10,
  cook_minutes: 20,
  source: "",
  ingredients: [
    { quantity: "1 1/2", unit: "cups", item: "flour", note: "sifted" },
  ],
  steps: [{ text: "Mix." }, { text: "Bake." }],
});
export async function fixture(t, overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), "recipebox-test-"));
  const entries = [];
  const config = {
    authMode: "local",
    publicUrl: "http://localhost",
    sessionSecret: password(),
    port: 3000,
    trustProxy: 0,
    secureCookies: false,
    registration: true,
    dataDir: dir,
    version: "test",
    production: true,
    ...overrides,
  };
  const { app, data } = createApp(config, {
    log: (level, event, fields) => entries.push({ level, event, ...fields }),
  });
  t.after(async () => {
    data.close();
    await rm(dir, { recursive: true, force: true });
  });
  const inspect = (sql, ...params) => {
    const db = new DatabaseSync(join(dir, "recipebox.db"));
    try {
      return db.prepare(sql).all(...params);
    } finally {
      db.close();
    }
  };
  const client = () => {
    const agent = request.agent(app);
    let csrf;
    const call = async (method, path, body) => {
      if (!csrf) csrf = (await agent.get("/auth/config")).body.csrf_token;
      let operation = agent[method](path)
        .set("Origin", config.publicUrl)
        .set("X-CSRF-Token", csrf);
      if (body !== undefined) operation = operation.send(body);
      const response = await operation;
      if (response.body?.csrf_token) csrf = response.body.csrf_token;
      return response;
    };
    return {
      agent,
      call,
      csrf: async () => {
        csrf = (await agent.get("/auth/config")).body.csrf_token;
        return csrf;
      },
      async register(username = "member") {
        const secret = password();
        const response = await call("post", "/auth/register", {
          username,
          password: secret,
          display_name: "Test Member",
        });
        if (response.status !== 201)
          throw new Error(
            `Registration failed: ${JSON.stringify(response.body)}`,
          );
        return { ...response.body.user, password: secret, response };
      },
    };
  };
  return { app, data, config, entries, dir, client, inspect };
}
