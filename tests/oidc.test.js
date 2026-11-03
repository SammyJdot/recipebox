import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { createHash } from "node:crypto";
import { fixture, password } from "./helpers.js";

// This provider exists only in tests. Production always performs real discovery
// and validates signatures, issuer, audience, state, nonce, and PKCE.
async function provider(t, overrides = {}) {
  const issuer = "https://provider.invalid";
  const secret = password();
  const f = await fixture(t, {
    authMode: "oidc",
    oidc: {
      issuer,
      clientId: "test-client",
      clientSecret: secret,
      redirectUri: "http://localhost/auth/oidc/callback",
      allowedGroup: null,
      ...overrides,
    },
  });
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "test-key",
    use: "sig",
    alg: "RS256",
  };
  let flow,
    claims = {},
    failSignature = false;
  const observed = [];
  t.mock.method(globalThis, "fetch", async (input, options = {}) => {
    const url = String(input);
    observed.push(url);
    if (url === `${issuer}/.well-known/openid-configuration`)
      return Response.json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      });
    if (url === `${issuer}/jwks`) return Response.json({ keys: [jwk] });
    if (url === `${issuer}/token`) {
      const body = new URLSearchParams(options.body);
      assert.equal(body.get("client_secret"), secret);
      assert.equal(body.get("client_id"), "test-client");
      assert.equal(
        createHash("sha256")
          .update(body.get("code_verifier"))
          .digest("base64url"),
        flow.searchParams.get("code_challenge"),
      );
      const signingKey = failSignature
        ? (await generateKeyPair("RS256")).privateKey
        : privateKey;
      const token = await new SignJWT({
        nonce: flow.searchParams.get("nonce"),
        name: "Test Member",
        email: "member@example.invalid",
        ...claims,
      })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(issuer)
        .setAudience("test-client")
        .setSubject("test-subject")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(signingKey);
      return Response.json({
        access_token: password(),
        token_type: "Bearer",
        expires_in: 300,
        id_token: token,
      });
    }
    throw new Error("Unexpected provider request");
  });
  const client = f.client();
  const start = async () => {
    const response = await client.agent.get("/auth/oidc").expect(302);
    flow = new URL(response.headers.location);
    assert.equal(flow.searchParams.get("scope"), "openid profile email");
    assert.equal(flow.searchParams.has("client_secret"), false);
    assert.equal(flow.searchParams.get("code_challenge_method"), "S256");
    return flow;
  };
  const finish = () =>
    client.agent
      .get("/auth/oidc/callback")
      .query({ code: "test-code", state: flow.searchParams.get("state") });
  return {
    ...f,
    client,
    start,
    finish,
    observed,
    setClaims: (value) => {
      claims = value;
    },
    badSignature: () => {
      failSignature = true;
    },
  };
}

test("OIDC discovery and signed confidential-client login use shared sessions and stable identity", async (t) => {
  const f = await provider(t);
  await f.start();
  await f.finish().expect(302);
  const user = (await f.client.agent.get("/api/me").expect(200)).body;
  assert.equal(user.display_name, "Test Member");
  assert.equal(user.role, "member");
  await f.start();
  await f.finish().expect(302);
  assert.equal((await f.client.agent.get("/api/me")).body.id, user.id);
  assert.equal(f.inspect("SELECT COUNT(*) AS count FROM users")[0].count, 1);
  const row = f.inspect("SELECT * FROM users")[0];
  assert.equal(row.oidc_issuer, "https://provider.invalid");
  assert.equal(row.oidc_sub, "test-subject");
  assert.equal(row.password_hash, null);
  assert.ok(f.observed.some((u) => u.endsWith("/jwks")));
  assert.ok(!JSON.stringify(f.entries).includes("test-code"));
  assert.ok(!JSON.stringify(f.entries).includes(f.config.oidc.clientSecret));
});

test("OIDC optional groups permit matching groups and deny absent groups", async (t) => {
  const f = await provider(t, { allowedGroup: "test-group" });
  await f.start();
  await f.finish().expect(401);
  await f.client.agent.get("/api/me").expect(401);
  assert.equal(f.inspect("SELECT COUNT(*) AS count FROM users")[0].count, 0);
  f.setClaims({ groups: ["test-group"] });
  await f.start();
  await f.finish().expect(302);
  await f.client.agent.get("/api/me").expect(200);
});

test("OIDC rejects state mismatch, nonce mismatch, callback replay and invalid signatures", async (t) => {
  const f = await provider(t);
  await f.start();
  await f.client.agent
    .get("/auth/oidc/callback")
    .query({ code: "test-code", state: "invalid" })
    .expect(401);
  await f.start();
  f.setClaims({ nonce: "wrong-nonce" });
  await f.finish().expect(401);
  f.setClaims({});
  await f.start();
  await f.finish().expect(302);
  await f.finish().expect(401);
  await f.start();
  f.badSignature();
  await f.finish().expect(401);
  assert.ok(
    f.inspect("SELECT * FROM audit_logs WHERE action='login.failure'").length >=
      4,
  );
});
