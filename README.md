# RecipeBox

A self-hostable recipe collection for any group of users. Save structured recipes,
organize them into shared boxes, add photos, scale ingredients, and print a clean
copy for the kitchen. RecipeBox starts empty: no default users, recipes, or boxes.

- Mobile-first React interface and an installable PWA manifest.
- Built-in local accounts or a standard OIDC identity provider, selected by configuration.
- Shared boxes; recipes can belong to multiple boxes.
- Optional free-form tags, with title, ingredient, and tag search plus box and exact-tag filters.
- Ordered ingredients and steps, fractional serving scaling, sources, and print view.
- Shared JPEG, PNG, and WebP photo galleries, uploader labels, and automatic or manual covers.
- Plain-text recipe comments with author editing and recipe-author moderation.
- SQLite, server-side sessions, structured stdout logs, and append-only audit records.
- One container and one persistent data volume. No external database required.

## Quick start with Docker Compose

Docker Engine and the Docker Compose plugin are required. Obtain a **published
version tag** from your registry first. This repository does not imply an image
has been published. Replace all angle-bracket placeholders before running:

```sh
cp .env.example .env
# Edit .env with your own values. Never commit it.
```

For local authentication set these values in `.env`:

```dotenv
RECIPEBOX_IMAGE=<registry>/<namespace>/<repository>:<version-tag>
PUBLIC_URL=<public-origin>
AUTH_MODE=local
SESSION_SECRET=<at-least-32-random-characters>
ALLOW_LOCAL_REGISTRATION=true
APP_VERSION=<version-tag>
```

`PUBLIC_URL` is the exact origin used by the browser (scheme, hostname, and
optional port, with no path). Generate a session secret with:

```sh
openssl rand -hex 32
```

Leave OIDC variables blank in local mode. Start the app:

```sh
docker compose pull
docker compose up -d --wait
```

Open your configured public URL. For direct local use the default port is 3000
and the default bind address is loopback. To expose a port to your LAN, explicitly
set `BIND_ADDRESS` and set `PUBLIC_URL` to match how browsers reach it.
For HTTPS behind a reverse proxy, configure `TRUST_PROXY` to match trusted proxy
hops so the secure session cookie works. Run one app container per data volume.

Create the first local account: it becomes **admin**. Later accounts become
members. Once accounts are created, set `ALLOW_LOCAL_REGISTRATION=false` and
recreate the service. Admin is a foundation role; there is no admin UI in v1.
In OIDC mode all newly provisioned users are members; identity comes from the provider.

If no image has been published, build one locally instead:

```sh
docker build --build-arg APP_VERSION=v0.3.0 -t recipebox:v0.3.0 .
# Set RECIPEBOX_IMAGE=recipebox:v0.3.0 in .env, then:
docker compose up -d --wait
```

## Configuration

All deployment settings come from environment variables. `.env.example` contains
placeholders only. The backend does not expose secrets to the browser. Compose
passes the listed settings into the container; it does not mount `.env`.

| Variable | Required / default | Meaning |
| --- | --- | --- |
| `PUBLIC_URL` | Required | Exact browser-facing HTTP(S) origin; used for CSRF, redirects and secure cookies. |
| `AUTH_MODE` | Required: `local` or `oidc` | Active login method; restart after changing it. |
| `SESSION_SECRET` | Required | At least 32 random characters; changing it invalidates sessions. |
| `ALLOW_LOCAL_REGISTRATION` | `true` | Set exactly `false` to prevent all local account creation through the app. |
| `OIDC_ISSUER` | Required in OIDC mode | HTTPS issuer supporting standard discovery. |
| `OIDC_CLIENT_ID` | Required in OIDC mode | Confidential client ID. |
| `OIDC_CLIENT_SECRET` | Required in OIDC mode | Server-side client secret. |
| `OIDC_REDIRECT_URI` | Required in OIDC mode | Exactly `<public-origin>/auth/oidc/callback`; register it with the provider. |
| `ALLOWED_OIDC_GROUP` | Unset | Optional exact value in the standard `groups` array claim in ID token or userinfo. If unset, any authenticated identity can log in. |
| `TRUST_PROXY` | `0` | Number of trusted reverse proxy hops. Leave zero for direct access; never trust unfiltered forwarded headers. |
| `PORT` | `3000` | Backend listening port; Compose fixes the container port to 3000. |
| `DATA_DIR` | `/data` | SQLite and upload directory. Compose fixes this to the persistent volume. For source development use a relative directory such as `./.data`. |
| `APP_VERSION` | `dev` | Version returned by health; image builds also accept the `APP_VERSION` build argument. |
| `NODE_ENV` | `production` in image | Runtime environment. Client error responses never include stack traces. |
| `RECIPEBOX_IMAGE` | Required by Compose | Full image reference including a version tag; do not rely on `latest`. |
| `BIND_ADDRESS` | `127.0.0.1` | Compose published port bind address. |
| `HOST_PORT` | `3000` | Compose host port. |

OIDC uses discovery, authorization code flow, PKCE, state, nonce, signed ID-token
validation, and scopes `openid profile email`. Client-secret basic, post, and JWT
methods are selected from discovery metadata. Tokens stay server-side and are
not retained in the session or database. The browser receives an httpOnly,
SameSite=Lax session cookie. An HTTPS public URL enables the Secure flag.
Logout ends the RecipeBox session; it does not log the user out of their provider.
Switching auth modes plus restarting rejects sessions issued through the old mode.
Records can hold both local credentials and an OIDC identity; v1 has no account-linking UI.
No accounts are linked by matching email addresses.

## Permissions

All logged-in users can see all boxes and recipes, create boxes and recipes, and
add or remove any recipe from any box. Only a recipe's author can edit or delete
it or choose its cover. Any logged-in user can upload photos to any recipe. A
photo can be deleted by its uploader or the recipe author. Only a box's creator can edit
or delete that box. Deleting a box keeps its recipes. Admin role does not override
these ownership rules. Box membership, privacy, and invites are not implemented.

Comments are flat plain text, ordered chronologically, with author and timestamp.
Any logged-in user can comment on any recipe. Only the comment author can edit
it; the comment author or recipe author can delete it. Comments must be non-empty,
at most 2,000 characters, and contain no HTML. Text is escaped when rendered.
Photos show uploader and timestamp in chronological upload order.

The automatic cover is the earliest photo uploaded by the recipe author, falling
back to the earliest other photo, then no image. An author's later upload takes
priority over other users' photos. Only the recipe author can set a manual cover
or clear it. A manual cover overrides automatic selection until changed, cleared,
or deleted; deleting it restores automatic selection. This rule applies to recipe
views, dashboard, search, and box lists. Existing v0.1.0 cover selections are
preserved as manual covers during the automatic database migration.

## Tags and servings

Tags are optional and entered as a comma-separated list in the recipe form.
There are no predefined tags. The server trims whitespace, lowercases, removes
empty entries, and deduplicates on save. A recipe may have at most 10 tags, each
at most 30 characters; HTML is rejected and text is escaped when rendered.
Only the recipe author can change tags, through the normal audited recipe update.
Tags appear on recipes and list cards. Search matches tags as well as titles and
ingredients; clicking a recipe tag applies an exact tag filter. Box filtering
continues to work with search and tags.

New recipes start with a blank servings field. Servings are optional; when
provided they must be whole numbers from 1 to 10,000. With no base servings,
quantities display exactly as entered and the scaler is hidden. With a base,
the scaler uses minimum 1 and step 1, with whole-number targets and the exact
target/base ratio. Ingredient fractions remain supported independently.
Existing servings are preserved during migration, including legacy fractional
bases. For a fractional legacy base, the initial scaler target rounds up to a
whole number without changing the stored base.

The v0.2.0 spinner offset was reproduced in Firefox: a minimum of `0.01` with
`step="any"` produced `4 → 4.01 → 5.01 → 6.01`. The same behavior occurred in a
bare HTML input, without recipe calculations. Minimum 1 and step 1 now produce
`4 → 5 → 6 → 5 → 4`; ingredient parsing and fraction formatting are unchanged.

## Data, health, and logging

The named `recipebox-data` volume contains `/data/recipebox.db` (SQLite in WAL
mode) and `/data/uploads`. Photos are decoded, metadata stripped, and stored as
WebP files; thumbnails are separate files, never database blobs. Each upload has
a 10 MB input limit, a 40-megapixel decode limit, and JPEG/PNG/WebP validation.
There is a 30-photo-per-recipe limit. Media requires authentication.

`GET /health` requires no login and reports `ok`, database status, and version.
Other API routes require login. Errors are JSON with `message` and `request_id`.
Requests return `X-Request-Id`. Logs are JSON to stdout:

```sh
docker compose logs -f recipebox
```

Logs include timestamps, level, service, request ID, event, and authenticated user
key; requests include method, route template, status, and duration. Request bodies,
query strings, OAuth codes, passwords, session IDs and tokens are never logged.
The `audit_logs` table stores actor key and display-name snapshot, timestamp,
action, entity type/key, and a short fixed detail. Audit rows are append-only,
enforced by SQLite triggers. Login success/failure, logout, recipe/box changes,
box organization, photo changes, cover set/cleared, and comment changes go to both logs and audit rows. Registration
and out-of-band password resets are also audited. Invalid CSRF requests are
rejected before any mutation. Authentication validation failures are audited. Cascaded photo and comment deletions use the
same atomic audit helper as the recipe deletion. Startup logs have a null request
ID; logs for requests and mutations carry the generated ID.

The PWA manifest supports installation. RecipeBox requires a connection to the
server; v1 deliberately has no service worker caching of private recipe data.
Quantities expressed as decimals, simple or mixed fractions, or supported Unicode
fractions scale with servings. Free-text quantities stay unchanged. Cooking times
stay unchanged; use judgment when changing batch size.

## Local password reset

There is no password-reset UI or email flow. An operator with host/container
access resets an existing local account out of band. The included CLI reads the
new password from stdin, hashes it with bcrypt (cost 12), audits the reset, and
revokes that user's sessions. It never accepts passwords in command arguments:

```sh
read -r -s -p 'New password: ' recipebox_password
printf '\n'
printf '%s\n' "$recipebox_password" | docker compose exec -T recipebox node server/reset-password.js '<username>'
unset recipebox_password
```

Use at least 12 characters and at most 72 UTF-8 bytes. There is no v1 account
creation bypass when registration is disabled. Temporarily enabling registration
requires an explicit operator configuration change.

## Update and roll back

Publishing an image **does not deploy it**. Production deployment, pulling an
image on a production host, and restarting that service require separate,
explicit approval. No workflow connects to or restarts a production host.

After that approval, update `RECIPEBOX_IMAGE` and `APP_VERSION` in `.env` to the
new version, then:

```sh
docker compose pull
docker compose up -d --wait
```

To roll back, set both variables to the previous version tag and run the same
commands. The named `/data` volume survives image replacement and container
recreation. Never run `docker compose down --volumes` against data you want to
keep. v0.3.0 uses schema version 3: recipe tags are stored separately and servings
can be null. Migration preserves existing servings and related recipe data.
Earlier versions do not understand optional servings and tags. Before upgrading,
make a consistent backup of the entire `/data` volume while the service is
stopped. Rolling back to an earlier version requires its pre-upgrade data snapshot
and image; changing the image tag alone is insufficient. Restoring that snapshot
also discards changes made after the backup.

## Development and releases

Node.js 24 is required. See [Development notes](docs/DEVELOPMENT.md) for setup,
architecture, tests, auth, and the release process. [CHANGELOG.md](CHANGELOG.md)
lists release changes. A version tag is not evidence of a successful publish;
check the tag workflow, registry, and GitHub release.

Pushes to `main` run tests, frontend build, browser checks, Docker build and
Compose smoke checks. Version tags (`vMAJOR.MINOR.PATCH`) run those checks again,
then publish only the tagged image, verify its registry digest and authenticated
pull, and create a GitHub release with changelog notes. For GHCR, publication
also reads package metadata and requires private visibility before the release
job runs; it never changes visibility. Image names derive from the repository,
without an account hardcoded in source or workflow. Configure these repository values before tagging:

| Setting | Kind | Purpose |
| --- | --- | --- |
| `CONTAINER_REGISTRY` | Repository variable | Registry hostname, without scheme. |
| `CONTAINER_NAMESPACE` | Optional repository variable | Registry namespace override; otherwise use the repository's owner/name, lowercased. |
| `REGISTRY_USERNAME` | Repository secret | Existing registry login username. |
| `REGISTRY_PASSWORD` | Repository secret | Existing registry token/password with image push permission. |
| `GITHUB_TOKEN` | Automatic Actions token | Release job needs `contents: write`; repository Actions policy must allow it. |

An existing target registry repository/package must be **private before publishing**.
A new GHCR package is created on its first push with private visibility; the
workflow verifies that visibility afterward through the GitHub Packages API.
Other registries require a privately configured destination and operator
verification. The workflow never changes package visibility. Do not tag a release
until the private destination behavior and credentials are confirmed. The
workflow fails explicitly when configuration/secrets are missing. SSH Git access alone does not supply registry credentials or an API
credential for manually creating releases.

## License

Copyright (C) 2026 SammyJdot. Licensed under **AGPL-3.0-only**;
see the full [LICENSE](LICENSE) and [NOTICE](NOTICE). If you modify the app and
let users interact with it over a network, provide those users access to the
corresponding source as required by AGPL section 13. No deployment-specific data
or credentials belong in the source distribution.
