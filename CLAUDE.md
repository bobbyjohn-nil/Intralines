# Intralines Bus Simulator — working notes

## Versioning (required)

At the end of every working session, cut exactly ONE new version:

1. Add one entry at the TOP of `src/ui/changelog.ts` — bump the version,
   date it, give the session a short title, and summarize everything that
   shipped in that session in player-facing language.
2. Do not add per-feature micro-versions mid-session; fold the whole
   session's work into the closing entry.
3. The newest entry's version is displayed automatically on the home
   screen (version chip + footer) — no other file needs touching.

## Testing before every push

- `npm test` — pipeline fixture tests.
- `npm run build` — type-check + production build.
- Playwright e2e against `npx vite preview --port 4173` (scripts live in
  the session scratchpad; flow: menu → Play → Riverton → found company →
  depot on industrial land (the airport works) → Sparrow → drivers → draw
  line → assign bus → verify moving buses, no console errors).

## Deployment

Pushing to the designated branch deploys to GitHub Pages via
`.github/workflows/deploy.yml`. TWO things gate this, and both must be
done or the push silently changes nothing that players can see:

1. the branch must be listed under `on.push.branches` in the workflow, and
2. the branch must be allowed by the `github-pages` **environment**
   (repo Settings → Environments → github-pages → Deployment branches).

Without (2) the run fails in about two seconds with no steps and no logs —
that is GitHub rejecting the branch, not a build error. After any deploy,
check the run actually succeeded before reporting the work as shipped.

Changing `src/game/data/pipeline.js` or
`scripts/bake-city.mjs` invalidates the CI city-pack cache and re-bakes
Worcester, Des Moines and Madison (slower deploy). Bump
`PACK_FORMAT_VERSION` in `src/game/data/idb.ts` whenever pack contents
change so browsers refresh their cached cities.
