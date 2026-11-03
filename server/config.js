import { resolve } from "node:path";

export function loadConfig(env = process.env) {
  const required = (name) => {
    if (!env[name]?.trim())
      throw new Error(`Missing environment variable: ${name}`);
    return env[name].trim();
  };
  const authMode = required("AUTH_MODE");
  if (!["local", "oidc"].includes(authMode))
    throw new Error("AUTH_MODE must be local or oidc");
  const publicUrl = new URL(required("PUBLIC_URL"));
  if (
    !["http:", "https:"].includes(publicUrl.protocol) ||
    publicUrl.pathname !== "/" ||
    publicUrl.search ||
    publicUrl.hash ||
    publicUrl.username ||
    publicUrl.password
  ) {
    throw new Error(
      "PUBLIC_URL must be an HTTP(S) origin without a path or credentials",
    );
  }
  const sessionSecret = required("SESSION_SECRET");
  if (sessionSecret.length < 32 || sessionSecret.includes("<"))
    throw new Error(
      "SESSION_SECRET must contain at least 32 random characters",
    );
  if (
    env.ALLOW_LOCAL_REGISTRATION &&
    !["true", "false"].includes(env.ALLOW_LOCAL_REGISTRATION)
  )
    throw new Error("ALLOW_LOCAL_REGISTRATION must be true or false");
  const port = Number(env.PORT || 3000);
  const trustProxy = Number(env.TRUST_PROXY || 0);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be 1–65535");
  if (!Number.isInteger(trustProxy) || trustProxy < 0)
    throw new Error("TRUST_PROXY must be a nonnegative hop count");
  const config = {
    authMode,
    publicUrl: publicUrl.origin,
    sessionSecret,
    port,
    trustProxy,
    secureCookies: publicUrl.protocol === "https:",
    registration: env.ALLOW_LOCAL_REGISTRATION !== "false",
    dataDir: resolve(env.DATA_DIR || "/data"),
    version: env.APP_VERSION || "dev",
    production: env.NODE_ENV === "production",
  };
  if (authMode === "oidc") {
    const issuer = new URL(required("OIDC_ISSUER"));
    if (
      issuer.protocol !== "https:" ||
      issuer.username ||
      issuer.password ||
      issuer.search ||
      issuer.hash
    )
      throw new Error("OIDC_ISSUER must be an HTTPS issuer URL");
    const redirectUri = new URL(required("OIDC_REDIRECT_URI"));
    if (redirectUri.href !== `${publicUrl.origin}/auth/oidc/callback`)
      throw new Error(
        "OIDC_REDIRECT_URI must be PUBLIC_URL followed by /auth/oidc/callback",
      );
    config.oidc = {
      issuer: required("OIDC_ISSUER"),
      clientId: required("OIDC_CLIENT_ID"),
      clientSecret: required("OIDC_CLIENT_SECRET"),
      redirectUri: redirectUri.href,
      allowedGroup: env.ALLOWED_OIDC_GROUP?.trim() || null,
    };
  }
  return config;
}
