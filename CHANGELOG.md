# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] - 2026-04-26

### Added
- `paintCanvas` now accepts `clearBefore`, `dx`, and `dy` options. Setting
  `clearBefore: true` makes the diff-op renderer stateless — clears the bbox
  every paint, then walks the full grid for that frame. Use this for moving
  sprites or multi-instance scenarios where the prior-frame assumption breaks.
- `npm test` runs the smoke suite via `tsx`. Now part of CI and `prepublishOnly`.

### Changed
- README: bundle size updated from "~16 kB" to "~20 kB packed" (paintRaster
  added 3.5 kB to dist). Added "Running the demo locally" section, and a
  v0.2.1 callout near the top.
- `paintRaster` JSDoc warns about its interaction with `withPalette`: a
  palette swap forces a fresh raster cache (~5–10 ms), unlike the diff path's
  microsecond swap. Use `prerasterize(swapped)` to absorb the cost off the
  hot path.
- Demo's `load()` now calls `prerasterize(sprite)` so switching to the stress
  field's raster mode doesn't stall on first paint.

## [0.2.0] - 2026-04-26

### Added
- `paintRaster(ctx, sprite, cursor, options?)` — pre-rasterizes each frame to
  an offscreen canvas at first paint, then issues a single `drawImage` per call.
  Trade-off vs the diff-op `paintCanvas`: gives up per-cell granularity but
  scales much better when rendering many instances of the same sprite (e.g.
  stress fields, sprite grids). Per-sprite cache via WeakMap, so
  palette-swapped variants get their own cache entry.
- `prerasterize(sprite)` — eagerly populate the raster cache (useful for SSR
  preroll or surfacing rasterization cost up front).
- `clearRasterCache(sprite?)` — drop the cache for one sprite.

### Changed
- README repositioned: "Tiny pixel animations for marketing pages, loading
  indicators, and dashboard widgets" — non-game framing, with explicit
  "When to use" guide. The pretext design lineage stays in the "Why" section.
- Demo's stress field gains a third paint mode toggle ("PixelFlow Raster")
  that uses the new `paintRaster` path. At 5000 instances of a 48×48 sprite,
  raster sustains 60 fps where the diff path drops below 30.

## [0.1.0] - 2026-04-25

Initial release.

### Added
- `compile()` — one-time analysis with diff-op compression
- `compileMemo()` / `clearCache()` — keyed compile cache
- `paintCanvas()`, `paintSVG()`, `paintAscii()`, `renderAscii()` — multi-target renderers driven from the same compiled state
- `prepareSVG()` — one-time `<rect>` allocation for SVG paint hot path
- `createAnimator()` — playback driver with start/stop/seek/step/redraw
- `withPalette()` — O(palette) structure-shared palette swap
- `measureFrameBounds()`, `measureUnionBounds()` — non-transparent bbox inspection
- `importImage()` — PNG/sprite-sheet to `SpriteSource` with frequency-based color quantization
- `FrameCursor` + `cursorStart` / `nextCursor` / `stepCursor` position helpers
- Browser demo (`demos/index.html`) with diff visualizer, timing chart, palette-swap benchmark, stress field, and PNG drop import
