# Development

## Stack and boundaries

RecipeBox uses Vite + React with React Router, Express 5, Node.js 24, and the
built-in `node:sqlite` module. The server serves the built SPA and authenticated
media from one origin. There are no seed accounts or records, and no external
database, hosted service, or mandatory identity provider.

- `server/config.js`: validates environment-only deployment configuration.
- `server/db.js`: every SQL query, schema initialization, transactions, session store, and data mapping. Keep SQL out of routes and scripts so a later database swap stays contained.
- `server/auth.js`: local and OIDC routes; one shared session and CSRF contract.
- `server/logging.js`: JSON logger, request logging, audit helper, and `requireAdmin` foundation.
- `server/api.js`: validated recipe, box, organization, and photo mutations with server-side ownership checks.
- `server/app.js`: middleware, health, protected media, SPA, and JSON error handling.
- `server/reset-password.js`: operator-only stdin password reset CLI, never an app route.
- `web/src`: dashboard, editor, viewer, and quantity scaling. The light UI uses neutral colors, system sans-serif typography, functional labels, and plain empty states. Styling is mobile-first with print rules. In OIDC mode the signed-out page contains the RecipeBox header and Sign in control; local mode retains its login and registration forms.

Data lives in `/data` in the container; `DATA_DIR` allows a relative development
directory. SQLite uses foreign keys, WAL, a busy timeout, and schema version 1.
Run one process/container per volume. Audit triggers disallow update/delete.
The image runs as the unprivileged `node` user with a read-only root filesystem
under Compose. Uploaded images are decoded and re-encoded to strip metadata;
random filenames prevent traversal and user-controlled paths. A crash between a
file write and database commit can leave an unreferenced file; normal failures
clean up files and never expose unreferenced uploads through media routes.

## Source setup

Use Node.js 24 with npm, then:

```sh
npm ci
cp .env.example .env
```

Edit `.env` to set `AUTH_MODE=local`, `PUBLIC_URL` to your chosen local origin,
`SESSION_SECRET` to a generated secret, and `DATA_DIR=./.data`. Do not commit the
file. For a production-style source run on one port:

```sh
npm run build
node --env-file=.env server/index.js
```

The backend never reads a dotenv file implicitly. `npm run dev` explicitly loads
`.env`. For Vite hot reload, also run `npm run dev:web` in another terminal and
set `PUBLIC_URL` to the Vite origin. Vite proxies auth, API and media to the
backend on port 3000. Serve built assets for print and end-to-end acceptance.

## Authentication and switching modes

Both modes issue the same httpOnly session cookie and store only user ID, active
mode, CSRF token, cookie metadata, and short-lived OIDC transaction checks in
SQLite sessions. No access or refresh tokens are persisted. Seven-day sessions
are checked against the currently configured mode on every request.

Local registration makes the first user admin in the same database transaction
that creates it; later users are members. Passwords use bcrypt cost 12 with
12-character minimum and 72-byte maximum. Registration can be disabled even on
an empty install. Password reset is strictly out of band using the documented
stdin CLI. Admin does not override author/creator checks.

OIDC uses HTTPS discovery and confidential client authentication, choosing basic,
post, or client-secret JWT from metadata. Requests use PKCE/S256, state and nonce;
callbacks validate issuer, audience, expiry, state, nonce and signatures via JWKS.
OIDC user identity is issuer + subject, never email. Userinfo is fetched when
advertised, with subject validation. Optional authorization uses an exact match
in an array `groups` claim; without a restriction any valid identity can log in.
Provider tokens remain only in request memory. The app does not provide OIDC
signup or a runtime login bypass. Local routes reject login in OIDC mode and vice
versa. Switch `AUTH_MODE`, supply that mode's variables, and restart/recreate the
service. v1 does not link identities or manage roles in the UI.

All write requests must include the CSRF token from `GET /auth/config` in
`X-CSRF-Token`, plus the exact `PUBLIC_URL` origin. Login regenerates the session
and CSRF token. Clients must refresh auth config after logout. Auth routes live
under `/auth`; application routes under `/api` all require login.
Cover selection uses `PUT /api/recipes/:id` with only `{ "cover_photo_id": <id> }`;
normal recipe updates use the complete validated recipe body. Photo uploads use
multipart field `photo`; only authors may modify photos. Repeated add/remove box
operations are idempotent and audit only actual changes.

## Tests and checks

```sh
npm run check
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:browser
docker build --build-arg APP_VERSION=ci -t recipebox:ci .
node scripts/container-smoke.js
```

`npm test` runs real temporary SQLite databases, real sessions and bcrypt hashes,
Supertest API calls, real Sharp image processing, and a test-only discovery/token/
JWKS provider with signed ID tokens. It tests invalid signatures, state, nonce,
mode switching and group gating. This test provider is never imported by runtime
code and does not bypass production authentication. It does not replace a real
provider acceptance test: provision `OIDC_ISSUER`, `OIDC_CLIENT_ID`,
`OIDC_CLIENT_SECRET`, and `OIDC_REDIRECT_URI` and verify login with that provider.

Browser tests serve the built app, register through the actual UI, and follow
recipe creation through SQLite, search, serving scaling, box organization,
photos, and print media. They cover desktop and mobile viewports. Browser test
state and credentials are ephemeral and kept out of tracked files.
The container smoke test starts Compose with a disposable named project/volume,
checks empty data, local login, author permissions, recipe and box CRUD,
multi-box organization, photos/covers/thumbnails, search, hashes, audits,
stdout request IDs, restart persistence, and runtime image hygiene (checking installed development package files rather than empty npm namespace directories). It also runs
the browser suite against that running image using `RECIPEBOX_TEST_URL`, then
removes **only its own** test volume. It requires Docker; a source build is not a Docker acceptance test.

`npm run check` checks JS syntax, YAML parsing, workflow triggers, the manifest,
and common credential/path mistakes. It complements review; it is not proof of
secret absence. Use `actionlint` for additional Actions schema and shell checks.
Dependencies are lockfile-pinned; review `npm audit` when updating dependencies.

## Audit and logging contract for new features

1. Validate inputs on the server; reject client author/creator/role assignments.
2. Load the current user from the shared session, and enforce ownership in the route. Use `requireAdmin` for future admin-only routes; no admin UI exists in v1.
3. Use the single audit helper for every successful business mutation. The helper commits the change and append-only audit record together, then writes the corresponding JSON stdout event. Photo cascades pass secondary events through that same helper so every record and log shares one transaction outcome. No success event is emitted for a rolled-back mutation.
4. Give events stable names, entity type/key and a short fixed detail. Never include secrets, tokens, passwords, recipe bodies, arbitrary request parameters, or provider responses in logs. Keep actor snapshots in audit rows even if records later change.
5. Preserve generated request IDs, `X-Request-Id`, JSON error shape, and the generic production error boundary. Query strings and OAuth codes must never enter access logs.
6. Add meaningful tests for authorization and the data effect. Keep documentation in the same commit as the behavior it describes.

## Git, images and releases

The GitHub repository is canonical. Work in logical, passing commits on `main`;
push after local checks and inspect Actions results. The main workflow tests and
builds an image, but never publishes or deploys. Branch protection is an operator
setting; this phase does not change hosting or provider configuration.

For a release, update package/lockfile versions together and add a dated
`CHANGELOG.md` section. Use semantic version tags such as `v0.1.0`. Before pushing
any tag, ensure `CONTAINER_REGISTRY`, optional `CONTAINER_NAMESPACE`, and repository
secrets `REGISTRY_USERNAME`/`REGISTRY_PASSWORD` are configured and the target image
repository is private. The release job's automatic token needs `contents: write`.
Tag verification requires the package version and changelog section to match.

```sh
git tag -a v0.1.0 -m 'Release v0.1.0'
git push origin v0.1.0
```

Tag pushes run checks, build/test Docker, authenticate with registry repository
secrets, publish a version-tagged image, verify the tag digest against the build
output and pull that digest on the CI runner, then create a GitHub release from
the changelog. For GHCR the publish job also reads package metadata with the
existing registry token and requires private visibility; it never changes a
registry setting. GitHub Packages metadata requires `read:packages` access
(the classic token used for publication must have the corresponding package
read/write access). No published image is started by these verification steps.
No `latest` tag is needed, no personal registry account is hardcoded,
and nothing publishes on an ordinary main push. A failed publish is a failed
check; no successful release is fabricated. If credentials are missing, do not
tag; report the exact missing variables/secrets. Release images support the
runner's Linux architecture (currently amd64); multi-architecture publication is
not implemented in v1.

Publishing is separate from deployment. **Production pulling and restarting need
separate explicit approval.** After approval, the operator changes the image tag,
pulls and recreates with Compose. To roll back, choose the previous tag and
repeat. Never remove the persistent data volume to update or roll back. Any
future schema change must document version compatibility and rollback behavior.

## Scope

No private boxes, invitations, import, OCR, shopping lists, meal planning,
comments, ratings, native apps, backups, password-reset UI, or admin UI. Do not
add these implicitly. No deployment or provider configuration changes are part
of building or publishing an image.
