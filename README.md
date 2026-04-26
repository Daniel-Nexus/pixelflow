# PixelFlow

Pretext-inspired pixel animation. Compile once, paint cheap, render anywhere.

**[Live demo →](https://daniel-nexus.github.io/pixelflow/demos/)** with diff visualizer,
compile-vs-paint timing chart, palette swap benchmark, stress field, and PNG drop import.

## Why

Most pixel animation code redraws the whole grid every frame. PixelFlow borrows
[chenglou/pretext](https://github.com/chenglou/pretext)'s setup/hot-path split:
the heavy work (palette extraction, frame-to-frame diffing, packing) happens
once in `compile()`, and per-frame painting is reduced to walking a packed
diff-op buffer. The same compiled state can drive Canvas, SVG, ASCII, or any
custom renderer in parallel.

| pretext | PixelFlow |
|---|---|
| `prepare()` (one-time, heavy) | `compile()` |
| `layout()` (cheap, per-call) | `paintCanvas()` / `paintSVG()` / `paintAscii()` |
| `LayoutCursor` (segment+grapheme) | `FrameCursor` |
| `walkLineRanges()` | `measureFrameBounds()` |
| `setLocale()` (palette/cache reset) | `withPalette()` / `clearCache()` |
| same prepared → multiple consumers | same compiled → canvas + svg + ascii |

## Install

```sh
npm install pretext-pixel
```

> Published as `pretext-pixel` on npm — the project name `PixelFlow` was too similar to an existing package, so the registry name references the inspiration ([chenglou/pretext](https://github.com/chenglou/pretext)) instead.

## Quick start

```ts
import {
  compile, prepareSVG,
  paintCanvas, paintSVG, paintAscii,
  createAnimator,
} from 'pretext-pixel';

// Author a sprite with a char grid + palette.
// '.' is reserved for transparent.
const sprite = compile({
  frames: [
    [
      "..RRRR..",
      ".RRRRRR.",
      ".R.RR.R.",
      "..RRRR..",
    ],
    [
      "..RRRR..",
      ".RRRRRR.",
      ".RRRRRR.",
      "..R..R..",
    ],
  ],
  palette: { R: '#dc2626' },
  speed: 120,  // ms per frame
});

// Hook up any number of paint targets — all read the same compiled state.
const ctx = canvas.getContext('2d');
const svgState = prepareSVG(svgEl, sprite);

const anim = createAnimator(sprite, [
  c => paintCanvas(ctx, sprite, c),
  c => paintSVG(svgState, sprite, c),
  c => paintAscii(preEl, sprite, c),
]);

anim.start();
```

## Core concepts

### `compile(source)` → `CompiledSprite`

Validates input, builds a palette (index 0 is always `transparent`),
converts each frame to a packed `Int8Array` of palette indices, and computes
inter-frame diff ops as `Int16Array`s of `[x, y, colorIndex, ...]`. Throws on
uneven frame dims, unknown palette chars, or `'.'` in the palette.

Includes `stats`:
- `frameCount`, `totalCells`, `totalDiffOps`
- `compressionRatio` — fraction of cells skipped vs full redraw (typically 0.7+)
- `compileMs`

### Cursors

A `FrameCursor` is just `{ frameIndex }`. Use `cursorStart`, `nextCursor()`,
`stepCursor()` to navigate. Mirrors pretext's `LayoutCursor`.

### Renderers

All renderers read `sprite.diffs[cursor.frameIndex]` and update only changed
cells. Add your own (WebGL, terminal, server-side PNG) by following the same
pattern: walk the flat `[x, y, colorIndex, ...]` buffer.

- `paintCanvas(ctx, sprite, cursor)` — `fillRect` at sprite resolution; scale
  via CSS with `image-rendering: pixelated`.
- `prepareSVG(host, sprite)` + `paintSVG(state, sprite, cursor)` — one `<rect>`
  per pixel created upfront, only `fill` attribute updated per frame.
- `renderAscii(sprite, cursor)` / `paintAscii(pre, sprite, cursor)` —
  luminance-mapped block characters (` ░▒▓█`).

### Inspection

- `measureFrameBounds(sprite, cursor)` — bbox of non-transparent pixels for
  one frame (think pretext's `measureNaturalWidth`).
- `measureUnionBounds(sprite)` — bbox covering every frame; useful for
  collision shapes or tight cropping.

### Theme swap

```ts
const damaged = withPalette(sprite, originalSource, {
  B: '#7f1d1d',  // remap blue to dark red
  L: '#dc2626',
});
```

Returns a new compiled sprite that reuses `diffs` and `grids` by reference —
the operation is O(palette size), not O(pixels). Run damaged/night/inverted
variants without recompiling.

### Memoization

```ts
import { compileMemo, clearCache } from 'pretext-pixel';
const sprite = compileMemo('hero-walk', source);  // cached by key
clearCache();
```

### Animator

Drives playback. Bind any number of paint callbacks; all run on each tick with
the same cursor. Supports `start`, `stop`, `seek`, `step`, `redraw` for scrub
controls and timelines.

### Image import

Convert a PNG/sprite-sheet into a `SpriteSource`:

```ts
import { importImage, compile } from 'pretext-pixel';

const img = new Image();
img.src = 'hero-walk.png';
img.onload = () => {
  const { source } = importImage(img, { rows: 1, cols: 4, maxColors: 12 });
  const sprite = compile(source);
  // ...
};
```

Frequency-based color quantization to single-char palette keys. Alpha below
the threshold becomes `'.'`.

## API summary

| function | purpose |
|---|---|
| `compile(source)` | one-time analysis + diff compression |
| `compileMemo(key, source)` / `clearCache()` | cached variant |
| `cursorStart`, `nextCursor`, `stepCursor` | position arithmetic |
| `paintCanvas(ctx, sprite, cursor, opts?)` | Canvas2D paint |
| `prepareSVG(host, sprite)` / `paintSVG(state, sprite, cursor)` | SVG paint |
| `renderAscii(sprite, cursor)` / `paintAscii(el, sprite, cursor)` | ASCII paint |
| `measureFrameBounds`, `measureUnionBounds` | non-transparent bbox |
| `withPalette(sprite, source, remap)` | palette swap, structure-shared |
| `createAnimator(sprite, paintFns, opts?)` | playback driver |
| `importImage(img, opts?)` | PNG → SpriteSource with quantize |

## License

MIT

---

Made by **[NEXUS AI Labs](https://ailabs.cross.nexus)**.
