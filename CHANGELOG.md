# Changelog

## [Unreleased]

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
