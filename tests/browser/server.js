import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createApp } from "../../server/app.js";
const dir = await mkdtemp(join(tmpdir(), "recipebox-browser-"));
const { app, data } = createApp({
  authMode: "local",
  publicUrl: "http://localhost:31991",
  sessionSecret: randomBytes(32).toString("hex"),
  port: 31991,
  trustProxy: 0,
  secureCookies: false,
  registration: true,
  dataDir: dir,
  version: "test",
  production: true,
});
const server = app.listen(31991, "localhost");
const stop = () =>
  server.close(async () => {
    data.close();
    await rm(dir, { recursive: true, force: true });
    process.exit(0);
  });
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
