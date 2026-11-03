import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { openData } from "./db.js";
import { auditHelper, createLogger } from "./logging.js";
const username = process.argv[2];
const dataDir = process.env.DATA_DIR || "/data";
if (
  !username ||
  process.stdin.isTTY ||
  !existsSync(join(dataDir, "recipebox.db"))
) {
  process.stderr.write(
    "Provide an existing local username and pipe a new password on stdin. DATA_DIR must contain an existing database.\n",
  );
  process.exit(1);
}
let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
  if (Buffer.byteLength(input) > 1024) {
    process.stderr.write("Password input too long\n");
    process.exit(1);
  }
}
const password = input.replace(/\r?\n$/, "");
if (
  password.length < 12 ||
  Buffer.byteLength(password) > 72 ||
  /[\r\n]/.test(password)
) {
  process.stderr.write(
    "Use a password of at least 12 characters and at most 72 UTF-8 bytes on one line.\n",
  );
  process.exit(1);
}
const data = openData(dataDir);
try {
  const user = data.localUser(username);
  if (!user?.password_hash) throw new Error("Existing local account required");
  const hash = await bcrypt.hash(password, 12);
  auditHelper(data, createLogger())(
    { requestId: randomUUID() },
    "password.reset",
    "user",
    user.id,
    "Local password reset out of band",
    () => {
      data.resetPassword(username, hash);
      data.invalidateUserSessions(user.id);
    },
  );
  process.stderr.write("Password changed; existing sessions revoked.\n");
} catch {
  process.stderr.write("Unable to reset the specified local account.\n");
  process.exitCode = 1;
} finally {
  data.close();
}
