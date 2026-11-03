import express from "express";
import session from "express-session";
import helmet from "helmet";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { openData } from "./db.js";
import { requestLogging, createLogger, auditHelper } from "./logging.js";
import { authRouter, csrfProtection } from "./auth.js";
import { apiRouter } from "./api.js";
import { HttpError } from "./validation.js";

export function createApp(config, options = {}) {
  const data = options.data || openData(config.dataDir);
  const log = options.log || createLogger();
  const audit = auditHelper(data, log);
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(requestLogging(log));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "upgrade-insecure-requests": config.secureCookies ? [] : null,
        },
      },
      strictTransportSecurity: config.secureCookies ? undefined : false,
    }),
  );
  app.get("/health", (req, res) => {
    try {
      if (!data.health()) throw new Error("Database unavailable");
      res.json({ ok: true, database: "ok", version: config.version });
    } catch {
      res.status(503).json({
        ok: false,
        database: "unavailable",
        version: config.version,
        request_id: req.requestId,
      });
    }
  });
  app.use(
    session({
      name: "recipebox.sid",
      secret: config.sessionSecret,
      store: data.sessionStore,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.secureCookies,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: "/",
      },
    }),
  );
  app.use((req, res, next) => {
    if (req.session.authMode === config.authMode && req.session.userId)
      req.user = data.user(req.session.userId);
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  const requireLogin = (req, res, next) =>
    req.user ? next() : next(new HttpError(401, "Login required"));
  app.use("/auth", csrfProtection(config), authRouter(config, data, audit));
  app.use(
    "/api",
    (req, res, next) => {
      res.set("Cache-Control", "no-store");
      next();
    },
    requireLogin,
    csrfProtection(config),
    apiRouter(config, data, audit, log),
  );
  app.use("/api", (req, res, next) =>
    next(new HttpError(404, "API route not found")),
  );
  app.use("/auth", (req, res, next) =>
    next(new HttpError(404, "Authentication route not found")),
  );
  app.get("/media/:filename", requireLogin, (req, res, next) => {
    const name = req.params.filename;
    if (
      !/^[a-f0-9-]{36}\.webp(?:\.thumb\.webp)?$/.test(name) ||
      !data.photoFile(name)
    )
      throw new HttpError(404, "Photo not found");
    res.set("Cache-Control", "private, max-age=3600");
    res.sendFile(join(config.dataDir, "uploads", name), (err) => {
      if (err) next(new HttpError(404, "Photo file not found"));
    });
  });
  const dist = resolve("dist");
  if (existsSync(join(dist, "index.html"))) {
    app.use(express.static(dist, { index: false, maxAge: "1h" }));
    app.get("/{*path}", (req, res) => {
      res.set("Cache-Control", "no-cache");
      res.sendFile(join(dist, "index.html"));
    });
  }
  app.use((req, res, next) => next(new HttpError(404, "Not found")));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    let status = err.status || 500;
    let message = status < 500 ? err.message : "An unexpected error occurred";
    if (err.code === "LIMIT_FILE_SIZE") {
      status = 413;
      message = "Photo exceeds the 10 MB limit";
    } else if (err.name === "MulterError") {
      status = 400;
      message =
        "Upload one photo at a time using the photo field (10 MB maximum)";
    } else if (err.type === "entity.parse.failed") {
      status = 400;
      message = "Invalid JSON";
    }
    if (status >= 500)
      log("error", "request.error", {
        request_id: req.requestId,
        ...(req.user ? { user_id: req.user.id } : {}),
      });
    res.status(status).json({ message, request_id: req.requestId });
  });
  return { app, data, log };
}
