import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import session from "express-session";

export function openData(dataDir) {
  mkdirSync(join(dataDir, "uploads"), { recursive: true });
  const sql = new DatabaseSync(join(dataDir, "recipebox.db"));
  sql.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, auth_source TEXT NOT NULL CHECK(auth_source IN ('local','oidc')),
      oidc_issuer TEXT, oidc_sub TEXT, username TEXT COLLATE NOCASE UNIQUE, password_hash TEXT,
      display_name TEXT NOT NULL, email TEXT, role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','admin')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), last_login_at TEXT,
      UNIQUE(oidc_issuer, oidc_sub), CHECK ((oidc_issuer IS NULL) = (oidc_sub IS NULL))
    );
    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      servings REAL NOT NULL, prep_minutes INTEGER, cook_minutes INTEGER, source TEXT NOT NULL DEFAULT '',
      author_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS ingredients (
      recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE, position INTEGER NOT NULL,
      quantity TEXT, unit TEXT NOT NULL DEFAULT '', item TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(recipe_id, position)
    );
    CREATE TABLE IF NOT EXISTS steps (
      recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE, position INTEGER NOT NULL,
      text TEXT NOT NULL, PRIMARY KEY(recipe_id, position)
    );
    CREATE TABLE IF NOT EXISTS boxes (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      creator_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS recipe_boxes (
      recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      box_id INTEGER NOT NULL REFERENCES boxes(id) ON DELETE CASCADE, PRIMARY KEY(recipe_id, box_id)
    );
    CREATE INDEX IF NOT EXISTS recipe_boxes_box ON recipe_boxes(box_id);
    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY, recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      stored_filename TEXT NOT NULL UNIQUE, original_filename TEXT NOT NULL, is_cover INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL, uploaded_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS photos_one_cover ON photos(recipe_id) WHERE is_cover = 1;
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      actor_id INTEGER, actor_display_name TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT, detail TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'Audit log is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'Audit log is append-only'); END;
    CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL);

  `);
  // Preserve existing cover selections when upgrading the v1 schema.
  if (
    !sql
      .prepare("PRAGMA table_info(recipes)")
      .all()
      .some((c) => c.name === "manual_cover_photo_id")
  ) {
    sql.exec(`BEGIN IMMEDIATE;
      ALTER TABLE recipes ADD COLUMN manual_cover_photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL;
      UPDATE recipes SET manual_cover_photo_id=(SELECT id FROM photos WHERE recipe_id=recipes.id AND is_cover=1);
      COMMIT;`);
  }
  sql.exec(`CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY, recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    author_id INTEGER NOT NULL REFERENCES users(id), text TEXT NOT NULL CHECK(length(trim(text)) BETWEEN 1 AND 2000),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX IF NOT EXISTS comments_recipe ON comments(recipe_id,created_at,id);
`);
  // Rebuild only the parent table with foreign keys disabled to preserve every child row.
  if (
    sql
      .prepare("PRAGMA table_info(recipes)")
      .all()
      .find((column) => column.name === "servings").notnull
  ) {
    sql.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;");
    try {
      sql.exec(`CREATE TABLE recipes_v3 (
        id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        servings REAL, prep_minutes INTEGER, cook_minutes INTEGER, source TEXT NOT NULL DEFAULT '',
        author_id INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        manual_cover_photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL
      );
      INSERT INTO recipes_v3 SELECT id,title,description,servings,prep_minutes,cook_minutes,source,author_id,created_at,updated_at,manual_cover_photo_id FROM recipes;
      DROP TABLE recipes;
      ALTER TABLE recipes_v3 RENAME TO recipes;`);
      if (sql.prepare("PRAGMA foreign_key_check").all().length)
        throw new Error("Recipe migration foreign key check failed");
      sql.exec("COMMIT");
    } catch (error) {
      sql.exec("ROLLBACK");
      sql.close();
      throw error;
    } finally {
      if (sql.isOpen) sql.exec("PRAGMA foreign_keys=ON");
    }
  }
  sql.exec(`CREATE TABLE IF NOT EXISTS recipe_tags (
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    position INTEGER NOT NULL, tag TEXT NOT NULL CHECK(length(tag) BETWEEN 1 AND 30),
    PRIMARY KEY(recipe_id,tag), UNIQUE(recipe_id,position)
  ); CREATE INDEX IF NOT EXISTS recipe_tags_tag ON recipe_tags(tag);
  PRAGMA user_version=3;`);
  const get = (query, ...params) => sql.prepare(query).get(...params);
  const all = (query, ...params) => sql.prepare(query).all(...params);
  const run = (query, ...params) => sql.prepare(query).run(...params);
  const stamp = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  const publicUser = (user) =>
    user && {
      id: user.id,
      display_name: user.display_name,
      email: user.email,
      username: user.username,
      role: user.role,
    };
  const photo = (p) => ({
    ...p,
    url: `/media/${p.stored_filename}`,
    thumbnail_url: `/media/${p.stored_filename}.thumb.webp`,
  });
  const details = (id) => {
    const recipe = get(
      "SELECT r.*, u.display_name AS author_name FROM recipes r JOIN users u ON u.id=r.author_id WHERE r.id=?",
      id,
    );
    if (!recipe) return null;
    return {
      ...recipe,
      tags: all(
        "SELECT tag FROM recipe_tags WHERE recipe_id=? ORDER BY position",
        id,
      ).map((row) => row.tag),
      ingredients: all(
        "SELECT quantity, unit, item, note FROM ingredients WHERE recipe_id=? ORDER BY position",
        id,
      ),
      steps: all(
        "SELECT text FROM steps WHERE recipe_id=? ORDER BY position",
        id,
      ),
      boxes: all(
        "SELECT b.* FROM boxes b JOIN recipe_boxes rb ON rb.box_id=b.id WHERE rb.recipe_id=? ORDER BY b.name",
        id,
      ),
      photos: all(
        "SELECT p.*, u.display_name AS uploader_name FROM photos p JOIN users u ON u.id=p.uploaded_by WHERE recipe_id=? ORDER BY p.created_at, p.id",
        id,
      ).map(photo),
      comments: all(
        "SELECT c.*, u.display_name AS author_name FROM comments c JOIN users u ON u.id=c.author_id WHERE recipe_id=? ORDER BY c.created_at,c.id",
        id,
      ),
    };
  };
  const content = (id, recipe) => {
    run("DELETE FROM recipe_tags WHERE recipe_id=?", id);
    (recipe.tags || []).forEach((tag, position) =>
      run(
        "INSERT INTO recipe_tags(recipe_id,position,tag) VALUES(?,?,?)",
        id,
        position,
        tag,
      ),
    );
    run("DELETE FROM ingredients WHERE recipe_id=?", id);
    recipe.ingredients.forEach((i, position) =>
      run(
        "INSERT INTO ingredients(recipe_id,position,quantity,unit,item,note) VALUES(?,?,?,?,?,?)",
        id,
        position,
        i.quantity,
        i.unit,
        i.item,
        i.note,
      ),
    );
    run("DELETE FROM steps WHERE recipe_id=?", id);
    recipe.steps.forEach((s, position) =>
      run(
        "INSERT INTO steps(recipe_id,position,text) VALUES(?,?,?)",
        id,
        position,
        s.text,
      ),
    );
  };
  const data = {
    close: () => sql.close(),
    publicUser,
    health: () => get("SELECT 1 AS ok").ok === 1,
    transaction(fn) {
      sql.exec("BEGIN IMMEDIATE");
      try {
        const value = fn();
        sql.exec("COMMIT");
        return value;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
    audit(actor, action, entityType, entityId, detail) {
      run(
        "INSERT INTO audit_logs(actor_id,actor_display_name,action,entity_type,entity_id,detail) VALUES(?,?,?,?,?,?)",
        actor?.id ?? null,
        actor?.display_name ?? null,
        action,
        entityType,
        entityId == null ? null : String(entityId),
        detail,
      );
    },
    user: (id) => publicUser(get("SELECT * FROM users WHERE id=?", id)),
    localUser: (username) =>
      get("SELECT * FROM users WHERE username=?", username),
    createLocal(input, hash) {
      const role =
        get(
          "SELECT COUNT(*) AS count FROM users WHERE password_hash IS NOT NULL",
        ).count === 0
          ? "admin"
          : "member";
      const result = run(
        "INSERT INTO users(auth_source,username,password_hash,display_name,email,role) VALUES(?,?,?,?,?,?)",
        "local",
        input.username,
        hash,
        input.display_name,
        input.email || null,
        role,
      );
      return data.user(Number(result.lastInsertRowid));
    },
    oidcUser(issuer, claims) {
      let row = get(
        "SELECT * FROM users WHERE oidc_issuer=? AND oidc_sub=?",
        issuer,
        claims.sub,
      );
      if (!row) {
        const result = run(
          "INSERT INTO users(auth_source,oidc_issuer,oidc_sub,display_name,email) VALUES(?,?,?,?,?)",
          "oidc",
          issuer,
          claims.sub,
          (claims.name || claims.preferred_username || "Member").slice(0, 120),
          typeof claims.email === "string" ? claims.email.slice(0, 254) : null,
        );
        row = data.user(Number(result.lastInsertRowid));
      } else {
        run(
          "UPDATE users SET display_name=?,email=? WHERE id=?",
          (claims.name || claims.preferred_username || row.display_name).slice(
            0,
            120,
          ),
          typeof claims.email === "string" ? claims.email.slice(0, 254) : null,
          row.id,
        );
      }
      return data.user(row.id);
    },
    login: (id) =>
      run(`UPDATE users SET last_login_at=${stamp} WHERE id=?`, id),
    recipes(q, boxId, tag = null) {
      const term = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
      const tagTerm = `%${q.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
      return all(
        `SELECT r.*, u.display_name AS author_name, p.stored_filename AS cover_filename FROM recipes r
        JOIN users u ON u.id=r.author_id LEFT JOIN photos p ON p.recipe_id=r.id AND p.is_cover=1
        WHERE (?='' OR r.title LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM ingredients i WHERE i.recipe_id=r.id AND i.item LIKE ? ESCAPE '\\') OR EXISTS(SELECT 1 FROM recipe_tags t WHERE t.recipe_id=r.id AND t.tag LIKE ? ESCAPE '\\'))
        AND (? IS NULL OR EXISTS(SELECT 1 FROM recipe_boxes rb WHERE rb.recipe_id=r.id AND rb.box_id=?))
        AND (? IS NULL OR EXISTS(SELECT 1 FROM recipe_tags t WHERE t.recipe_id=r.id AND t.tag=?))
        ORDER BY r.updated_at DESC, r.id DESC LIMIT 500`,
        q,
        term,
        term,
        tagTerm,
        boxId,
        boxId,
        tag,
        tag,
      ).map((r) => ({
        ...r,
        tags: all(
          "SELECT tag FROM recipe_tags WHERE recipe_id=? ORDER BY position",
          r.id,
        ).map((row) => row.tag),
        thumbnail_url: r.cover_filename
          ? `/media/${r.cover_filename}.thumb.webp`
          : null,
      }));
    },
    recipe: details,
    createRecipe(input, authorId) {
      const result = run(
        "INSERT INTO recipes(title,description,servings,prep_minutes,cook_minutes,source,author_id) VALUES(?,?,?,?,?,?,?)",
        input.title,
        input.description,
        input.servings ?? null,
        input.prep_minutes,
        input.cook_minutes,
        input.source,
        authorId,
      );
      const id = Number(result.lastInsertRowid);
      content(id, input);
      return id;
    },
    updateRecipe(id, input) {
      run(
        `UPDATE recipes SET title=?,description=?,servings=?,prep_minutes=?,cook_minutes=?,source=?,updated_at=${stamp} WHERE id=?`,
        input.title,
        input.description,
        input.servings ?? null,
        input.prep_minutes,
        input.cook_minutes,
        input.source,
        id,
      );
      content(id, input);
    },
    deleteRecipe: (id) => run("DELETE FROM recipes WHERE id=?", id),
    boxes: () =>
      all(
        "SELECT b.*, COUNT(rb.recipe_id) AS recipe_count FROM boxes b LEFT JOIN recipe_boxes rb ON rb.box_id=b.id GROUP BY b.id ORDER BY b.name COLLATE NOCASE",
      ),
    box: (id) => get("SELECT * FROM boxes WHERE id=?", id),
    createBox(input, creatorId) {
      return Number(
        run(
          "INSERT INTO boxes(name,description,creator_id) VALUES(?,?,?)",
          input.name,
          input.description,
          creatorId,
        ).lastInsertRowid,
      );
    },
    updateBox: (id, input) =>
      run(
        `UPDATE boxes SET name=?,description=?,updated_at=${stamp} WHERE id=?`,
        input.name,
        input.description,
        id,
      ),
    deleteBox: (id) => run("DELETE FROM boxes WHERE id=?", id),
    hasRecipeBox: (boxId, recipeId) =>
      Boolean(
        get(
          "SELECT 1 FROM recipe_boxes WHERE box_id=? AND recipe_id=?",
          boxId,
          recipeId,
        ),
      ),
    addRecipeBox: (boxId, recipeId) =>
      run(
        "INSERT INTO recipe_boxes(box_id,recipe_id) VALUES(?,?)",
        boxId,
        recipeId,
      ),
    removeRecipeBox: (boxId, recipeId) =>
      run(
        "DELETE FROM recipe_boxes WHERE box_id=? AND recipe_id=?",
        boxId,
        recipeId,
      ),
    photo: (id) => {
      const p = get(
        "SELECT p.*, u.display_name AS uploader_name FROM photos p JOIN users u ON u.id=p.uploaded_by WHERE p.id=?",
        id,
      );
      return p ? photo(p) : null;
    },
    photoFile: (name) =>
      get(
        "SELECT id FROM photos WHERE stored_filename=?",
        name.replace(/\.thumb\.webp$/, ""),
      ),
    createPhoto(recipeId, stored, original, userId) {
      const row = get(
        "SELECT COALESCE(MAX(position),-1)+1 AS next FROM photos WHERE recipe_id=?",
        recipeId,
      );
      const photoId = Number(
        run(
          "INSERT INTO photos(recipe_id,stored_filename,original_filename,is_cover,position,uploaded_by) VALUES(?,?,?,?,?,?)",
          recipeId,
          stored,
          original,
          0,
          row.next,
          userId,
        ).lastInsertRowid,
      );
      data.syncCover(recipeId);
      return photoId;
    },
    syncCover(recipeId) {
      const selected = get(
        `SELECT p.id FROM photos p JOIN recipes r ON r.id=p.recipe_id
        WHERE r.id=? ORDER BY (p.id=r.manual_cover_photo_id) IS TRUE DESC,
        (p.uploaded_by=r.author_id) DESC, p.created_at, p.id LIMIT 1`,
        recipeId,
      );
      run("UPDATE photos SET is_cover=0 WHERE recipe_id=?", recipeId);
      if (selected) run("UPDATE photos SET is_cover=1 WHERE id=?", selected.id);
    },
    cover(recipeId, photoId) {
      run(
        "UPDATE recipes SET manual_cover_photo_id=? WHERE id=?",
        photoId,
        recipeId,
      );
      data.syncCover(recipeId);
      run(`UPDATE recipes SET updated_at=${stamp} WHERE id=?`, recipeId);
    },
    deletePhoto(id) {
      const p = data.photo(id);
      run("DELETE FROM photos WHERE id=?", id);
      data.syncCover(p.recipe_id);
    },
    comment: (id) => get("SELECT * FROM comments WHERE id=?", id),
    createComment(recipeId, authorId, text) {
      return Number(
        run(
          "INSERT INTO comments(recipe_id,author_id,text) VALUES(?,?,?)",
          recipeId,
          authorId,
          text,
        ).lastInsertRowid,
      );
    },
    updateComment: (id, text) =>
      run(
        `UPDATE comments SET text=?,updated_at=${stamp} WHERE id=?`,
        text,
        id,
      ),
    deleteComment: (id) => run("DELETE FROM comments WHERE id=?", id),
    resetPassword(username, hash) {
      const result = run(
        "UPDATE users SET password_hash=? WHERE username=? AND password_hash IS NOT NULL",
        hash,
        username,
      );
      return Number(result.changes);
    },
    invalidateUserSessions(userId) {
      run("DELETE FROM sessions WHERE json_extract(data,'$.userId')=?", userId);
    },
  };
  class SQLiteStore extends session.Store {
    get(sid, cb) {
      try {
        const row = get(
          "SELECT data FROM sessions WHERE sid=? AND expires>?",
          sid,
          Date.now(),
        );
        cb(null, row ? JSON.parse(row.data) : null);
      } catch (e) {
        cb(e);
      }
    }
    set(sid, value, cb = () => {}) {
      try {
        run(
          "INSERT OR REPLACE INTO sessions(sid,data,expires) VALUES(?,?,?)",
          sid,
          JSON.stringify(value),
          new Date(value.cookie.expires).getTime(),
        );
        cb();
      } catch (e) {
        cb(e);
      }
    }
    destroy(sid, cb = () => {}) {
      try {
        run("DELETE FROM sessions WHERE sid=?", sid);
        cb();
      } catch (e) {
        cb(e);
      }
    }
    touch(sid, value, cb = () => {}) {
      try {
        run(
          "UPDATE sessions SET expires=? WHERE sid=?",
          new Date(value.cookie.expires).getTime(),
          sid,
        );
        cb();
      } catch (e) {
        cb(e);
      }
    }
  }
  data.sessionStore = new SQLiteStore();
  const cleanup = setInterval(
    () => run("DELETE FROM sessions WHERE expires<=?", Date.now()),
    60 * 60 * 1000,
  );
  cleanup.unref();
  data.close = () => {
    clearInterval(cleanup);
    sql.close();
  };
  return data;
}
