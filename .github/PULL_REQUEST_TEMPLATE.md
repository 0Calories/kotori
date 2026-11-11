<!--
  PR title must follow Conventional Commits: `feat(app): ...`, `fix(dictionary): ...`, `chore: ...`
  Link an issue to close on squash merge when applicable: `Closes #123`
  Commit PR screenshots to the shared orphan `assets` branch under `<pr-or-slug>/<file>.png`
  rather than creating a new `pr-assets/*` branch.
-->

## Summary

<!-- Concise explanation + small tree, diff sketch, or call flow -->

## Evidence

- **Before:** <!-- failing behavior, screenshot, or baseline -->
- **After:** <!-- passing tests (`pnpm nx affected -t lint typecheck test check`), output, or screenshot -->

## Merge Danger

**Door:** <!-- two-way | one-way (e.g. irreversible migration or public contract change) -->

**Blast Radius:** <!-- narrow | module/surface affected -->
