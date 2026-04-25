# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
