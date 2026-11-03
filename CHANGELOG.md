# Changelog

## [Unreleased]

## [0.3.0] — 2026-11-03

- Fix the Firefox servings-spinner offset caused by the old minimum of 0.01; whole-number arrows now follow 4 → 5 → 6 → 5 → 4 with exact target/base scaling.
- Keep ingredient fraction handling unchanged and add native Firefox plus desktop/mobile scaler regressions.
- Start new recipes with blank optional servings; preserve written quantities and hide scaling when no base is set.
- Preserve existing servings and related data through schema version 3 migration.
- Add optional comma-separated tags, normalized and validated on the server, with author-only editing audited as recipe updates.
- Display tags on recipes and list cards; support tag search and exact click-to-filter alongside boxes.
- Extend API, browser, migration, and container tests and document upgrade and rollback requirements.

## [0.2.0] — 2026-11-03

- Add chronological plain-text recipe comments, with author editing and author or recipe-owner deletion enforced on the server.
- Allow every logged-in user to upload recipe photos, with uploader names and timestamps; restrict deletion to the uploader or recipe author.
- Select covers automatically from the recipe author's earliest photo, then other uploads, with author-only manual overrides and automatic fallback.
- Strip uploaded photo metadata and require authentication for original images and thumbnails.
- Audit comment changes and cover selection, including deletion cascades and non-author uploads.
- Migrate existing data without losing selected covers, and test permissions, cover behavior, metadata, migration, and desktop/mobile flows.

## [0.1.0] — 2026-11-03

- Add local and OIDC login with shared server-side sessions and recipe author permissions.
- Create and edit recipes with structured ingredients, ordered steps, sources, and photos.
- Organize recipes into shared boxes, including adding one recipe to multiple boxes.
- Search by title or ingredient, filter by box, scale fractional quantities, and print recipes.
- Generate photo thumbnails and support cover selection and photo deletion.
- Record append-only audit events and structured request logs, with a public health endpoint and admin role foundation.
- Provide an out-of-band password reset command with session revocation and auditing.
- Use a minimal light interface with neutral colors, system fonts, and plain empty states.
- Package the app with Docker, persistent SQLite and uploads storage, CI checks, and version-tag release automation.
- Verify published image digests, authenticated pulls, and private GHCR package visibility before creating a GitHub release.
- Include the AGPL-3.0-only license and self-hosting and development documentation.
