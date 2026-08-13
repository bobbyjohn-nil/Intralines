# Supplying hand-made bus models

The buses on the map and in the station viewer are built in code. This
pipeline lets the art team replace any of them with real models — no code
changes, and the built-in meshes remain the automatic fallback, so a
missing or broken file can never break the game.

## Drop-in, in three steps

1. Export your model as a **binary glTF (`.glb`)**, textures embedded.
2. Put it in **`public/models/`**.
3. List it in **`public/models/manifest.json`**:

```json
{
  "models": {
    "citybus":  { "file": "metro40.glb" },
    "minibus":  { "file": "sparrow.glb", "rotateDeg": 90 },
    "electric": { }
  }
}
```

An entry with no `file` defaults to `<id>.glb`. Valid ids: `minibus`,
`citybus`, `artic`, `doubledeck`, `electric`. Any bus not listed keeps the
built-in mesh. Players see new models on their next visit.

## Authoring conventions

| Convention | Value |
|---|---|
| Format | glTF 2.0 binary (`.glb`), **everything embedded** — external texture files are rejected |
| Units | metres |
| Forward | **+X** (use `rotateDeg` in the manifest if your exporter differs) |
| Ground | wheels at y = 0 (auto-corrected, but export clean anyway) |
| Origin | roughly centred (auto-corrected) |
| Scale | free by default — the game **autofits** to each bus's in-game length (minibus 7 m, citybus/doubledeck/electric 11 m, artic 16 m). Exporting at true scale? Set `"autofit": false` |
| Budget | **≤ 2.5 MB per file**; aim well under. These load on page open and draw dozens of times |
| Poly count | keep it toy-scale — the whole game is a miniature; a 100k-tri bus will look wrong *and* run hot |

## Naming: how the game talks to your model

The game recolors and animates models by **name** — these are the only
contracts:

| Name | On | What the game does |
|---|---|---|
| `Brand` | a **material** | Repainted the player's company color (every company sees its own livery) |
| `Stripe` | a **material** | Repainted the line color of whichever route the bus is on |
| `DoorCurb` | a **node/object** | The station viewer slides this open when the bus serves a stop (rest position: kerb side, left of travel). Omit it and the viewer draws its own dark panel |

Everything else — glass, tyres, lights — is yours; the game leaves it
untouched. (Built-in meshes glow their windows at night; custom models
currently don't, so bake your night look into the materials if you care.)

## Verifying your work

```
node scripts/check-models.mjs     # manifest + files + naming, exits non-zero on errors
node scripts/make-sample-model.mjs [id]   # writes the reference sample.glb
npm run dev                       # then open a city and look
```

The dev console logs `custom bus models loaded: …` when your files are in.
`check-models` also runs in CI before every deploy, so a bad manifest or
oversized file fails the build instead of shipping.

The **sample** (`make-sample-model.mjs`) is the contract in file form — a
crude box bus with correctly named `Brand`/`Stripe` materials and a
`DoorCurb` node. It is intentionally ugly; it exists so you can diff your
export's structure against something known-good. `sample.glb` is
git-ignored: never ship it.

## What players experience

- Models load once per visit, in parallel, after the map is up; buses
  already driving swap onto the new model the moment it arrives.
- Offline play falls back to built-in meshes until the files are cached by
  a visit with network.
- A file that 404s or fails to parse logs a console warning and falls back
  — players never see an error for an art problem.
