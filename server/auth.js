import { Router } from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import * as oidc from "openid-client";
import {
  validate,
  credentialsSchema,
  registerSchema,
  HttpError,
} from "./validation.js";

export const csrfToken = (req) =>
  (req.session.csrf ||= randomBytes(32).toString("hex"));
export const saveSession = (req) =>
  new Promise((resolve, reject) =>
    req.session.save((e) => (e ? reject(e) : resolve())),
  );
const regenerate = (req) =>
  new Promise((resolve, reject) =>
    req.session.regenerate((e) => (e ? reject(e) : resolve())),
  );
export function csrfProtection(config) {
  return (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const provided = req.get("X-CSRF-Token") || "";
    const expected = req.session.csrf || "";
    if (
      req.get("Origin") !== config.publicUrl ||
      !expected ||
      !/^[a-f0-9]{64}$/.test(provided) ||
      provided.length !== expected.length ||
      !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    )
      return next(
        new HttpError(
          403,
          "Request verification failed. Reload and try again.",
        ),
      );
    next();
  };
}
export function authRouter(config, data, audit) {
  const router = Router();
  const loginLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req, res) => {
      audit(req, "login.failure", "user", null, "Login rate limit reached");
      res
        .status(429)
        .json({
          message: "Too many login attempts. Try again later.",
          request_id: req.requestId,
        });
    },
  });
  const localOnly = (req, res, next) =>
    config.authMode === "local"
      ? next()
      : next(new HttpError(404, "Local authentication is disabled"));
  let oidcConfiguration;
  // Discovery stays server-side; tokens are discarded after identity verification.
  const provider = async () => {
    if (!oidcConfiguration) {
      const discovered = await oidc.discovery(
        new URL(config.oidc.issuer),
        config.oidc.clientId,
        config.oidc.clientSecret,
      );
      const metadata = discovered.serverMetadata();
      const methods = metadata.token_endpoint_auth_methods_supported || [
        "client_secret_basic",
      ];
      const authenticate = methods.includes("client_secret_basic")
        ? oidc.ClientSecretBasic(config.oidc.clientSecret)
        : methods.includes("client_secret_post")
          ? oidc.ClientSecretPost(config.oidc.clientSecret)
          : methods.includes("client_secret_jwt")
            ? oidc.ClientSecretJwt(config.oidc.clientSecret)
            : null;
      if (!authenticate)
        throw new Error("Unsupported confidential client authentication");
      const configured = new oidc.Configuration(
        metadata,
        config.oidc.clientId,
        config.oidc.clientSecret,
        authenticate,
      );
      oidc.enableNonRepudiationChecks(configured);
      oidcConfiguration = configured;
    }
    return oidcConfiguration;
  };
  async function login(req, user) {
    await regenerate(req);
    req.session.userId = user.id;
    req.session.authMode = config.authMode;
    req.user = user;
    csrfToken(req);
    audit(
      req,
      "login.success",
      "user",
      user.id,
      `${config.authMode} login`,
      () => data.login(user.id),
    );
    await saveSession(req);
  }
  router.get("/config", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      auth_mode: config.authMode,
      allow_registration: config.authMode === "local" && config.registration,
      csrf_token: csrfToken(req),
    });
  });
  router.post("/register", localOnly, loginLimit, async (req, res) => {
    if (!config.registration)
      throw new HttpError(403, "Local registration is disabled");
    const input = validate(registerSchema, req.body);
    const hash = await bcrypt.hash(input.password, 12);
    let user;
    try {
      user = audit(
        req,
        "user.registered",
        "user",
        (u) => u.id,
        "Local account registered",
        () => {
          if (data.localUser(input.username))
            throw new HttpError(409, "Username is unavailable");
          return data.createLocal(input, hash);
        },
      );
    } catch (e) {
      if (e.status === 409)
        audit(
          req,
          "login.failure",
          "user",
          null,
          "Local registration rejected",
        );
      throw e;
    }
    await login(req, user);
    res.status(201).json({ user, csrf_token: req.session.csrf });
  });
  const dummyHash = bcrypt.hashSync(randomBytes(32).toString("hex"), 12);
  router.post("/login", localOnly, loginLimit, async (req, res) => {
    let input;
    try {
      input = validate(credentialsSchema, req.body);
    } catch (error) {
      audit(req, "login.failure", "user", null, "Local credentials rejected");
      throw error;
    }
    const found = data.localUser(input.username);
    const valid = await bcrypt.compare(
      input.password,
      found?.password_hash || dummyHash,
    );
    if (!found?.password_hash || !valid) {
      audit(req, "login.failure", "user", null, "Local credentials rejected");
      throw new HttpError(401, "Incorrect username or password");
    }
    const user = data.publicUser(found);
    await login(req, user);
    res.json({ user, csrf_token: req.session.csrf });
  });
  router.post("/logout", async (req, res) => {
    if (!req.user) throw new HttpError(401, "Login required");
    audit(req, "logout", "user", req.user.id, "Session ended");
    await new Promise((resolve, reject) =>
      req.session.destroy((e) => (e ? reject(e) : resolve())),
    );
    res.clearCookie("recipebox.sid", {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: config.secureCookies,
    });
    res.status(204).end();
  });
  router.get("/oidc", loginLimit, async (req, res) => {
    if (config.authMode !== "oidc")
      throw new HttpError(404, "OIDC authentication is disabled");
    try {
      const client = await provider();
      const verifier = oidc.randomPKCECodeVerifier();
      const state = oidc.randomState();
      const nonce = oidc.randomNonce();
      req.session.oidc = { verifier, state, nonce, started: Date.now() };
      const url = oidc.buildAuthorizationUrl(client, {
        redirect_uri: config.oidc.redirectUri,
        scope: "openid profile email",
        state,
        nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: "S256",
      });
      await saveSession(req);
      res.redirect(url.href);
    } catch {
      audit(req, "login.failure", "user", null, "OIDC initiation failed");
      throw new HttpError(502, "Unable to contact identity provider");
    }
  });
  router.get("/oidc/callback", loginLimit, async (req, res) => {
    if (config.authMode !== "oidc")
      throw new HttpError(404, "OIDC authentication is disabled");
    try {
      const pending = req.session.oidc;
      delete req.session.oidc;
      await saveSession(req);
      if (!pending || Date.now() - pending.started > 10 * 60 * 1000)
        throw new Error("Expired login");
      const client = await provider();
      const callback = new URL(req.originalUrl, config.publicUrl);
      const tokens = await oidc.authorizationCodeGrant(client, callback, {
        pkceCodeVerifier: pending.verifier,
        expectedState: pending.state,
        expectedNonce: pending.nonce,
        idTokenExpected: true,
      });
      const identity = tokens.claims();
      if (!identity?.sub) throw new Error("Missing subject");
      // ID token claims are verified by openid-client; userinfo also verifies sub.
      let claims = identity;
      if (client.serverMetadata().userinfo_endpoint) {
        const info = await oidc.fetchUserInfo(
          client,
          tokens.access_token,
          identity.sub,
        );
        claims = { ...identity, ...info };
      }
      if (
        config.oidc.allowedGroup &&
        (!Array.isArray(claims.groups) ||
          !claims.groups.includes(config.oidc.allowedGroup))
      )
        throw new Error("Group restriction");
      if (typeof claims.name !== "string") delete claims.name;
      if (typeof claims.preferred_username !== "string")
        delete claims.preferred_username;
      const user = data.transaction(() =>
        data.oidcUser(client.serverMetadata().issuer, claims),
      );
      await login(req, user);
      res.redirect("/");
    } catch {
      audit(req, "login.failure", "user", null, "OIDC response rejected");
      throw new HttpError(
        401,
        "Identity provider login failed or access was denied",
      );
    }
  });
  return router;
}
