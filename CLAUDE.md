# Music Game

Single-file static site (`index.html`) deployed on Vercel.

Live URL: https://music-game-iva.vercel.app/

## Deployment

- Hosted on **Vercel**, auto-deploys from `main`.
- Workflow: open a PR from the working branch, then **always merge to `main`** so Vercel publishes the change. Don't leave changes on feature branches.
- `vercel.json` controls routing; `index.html` is the entry point.

## Testing

- Run `node --test tests/*.mjs` (Node ≥ 20, no dependencies).
- The suite extracts the inline `<script>` from `index.html` and runs it in a
  `node:vm` sandbox with a stub DOM/canvas/audio, covering note frequencies,
  ring-slot geometry, projectile flight on both layouts, and static HTML checks
  (duplicate ids, dangling `getElementById` targets).
- There is intentionally no `package.json` — adding one could change how
  Vercel treats the static deployment.
