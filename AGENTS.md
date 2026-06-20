# Repo Agents Notes

This is a Home Assistant custom Lovelace card for Valetudo map rendering.

- Primary source file: `valetudo-hass-card.js`
- Distribution bundle: `dist/valetudo-hass-card.js` (kept in sync with source)
- No build tooling is required in this repository; edits are applied directly to
  `valetudo-hass-card.js` and mirrored to `dist/valetudo-hass-card.js`.
- Avoid broad, speculative refactors. Keep changes scoped to map fetch, map draw,
  and UI rendering behavior.
- After map rendering changes, verify robot icon alignment and path/floor/segment
  colors against a real Valetudo map snapshot.

