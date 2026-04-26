/**
 * PixelFlow — pretext-inspired pixel animation library
 *
 * Design philosophy borrowed from chenglou/pretext:
 *   1. compile() does heavy work once  (cf. pretext's prepare()).
 *   2. paint*() is cheap, called every frame  (cf. pretext's layout()).
 *   3. A position abstraction (FrameCursor) lets you swap render targets.
 *   4. The same compiled state feeds multiple consumers (canvas, svg, ascii, ...).
 *
 * Pretext stays in pure-arithmetic land for layout. PixelFlow stays in
 * "diff ops only" land for painting: between frames we emit only cells
 * whose color changed, so per-frame work scales with motion, not sprite area.
 *
 * MIT License.
 */
/** A single frame: an array of equal-length strings. Each char is a palette key. */
export type Frame = readonly string[];
/** Palette: char -> CSS color. The key '.' is reserved for transparent. */
export type Palette = Readonly<Record<string, string>>;
/** Author-facing input passed to compile(). */
export interface SpriteSource {
    readonly frames: readonly Frame[];
    readonly palette: Palette;
    /** Optional ms delay between frames. Default: 100. */
    readonly speed?: number;
    /** Optional name for debugging/tooling. */
    readonly name?: string;
    /** Optional metadata (hitbox, anchor, gameplay events). Carried through compile(). */
    readonly meta?: Readonly<Record<string, unknown>>;
}
/** Diff ops for one frame, packed as flat [x0, y0, c0, x1, y1, c1, ...]. */
export type DiffOps = Int16Array;
/** Compiled, paint-ready sprite. Treat as opaque — fields are exposed for tooling/inspection. */
export interface CompiledSprite {
    readonly width: number;
    readonly height: number;
    /** Palette index 0 is always 'transparent'. Indexes 1..N map to colors. */
    readonly palette: readonly string[];
    /** Per-frame diff ops. Frame 0 paints all non-transparent cells from blank. */
    readonly diffs: readonly DiffOps[];
    /** Per-frame full grid as palette indices (row-major, length = w*h). For renderers that prefer full state. */
    readonly grids: readonly Int8Array[];
    /** Optional ms delay between frames. */
    readonly speed: number;
    readonly name: string;
    readonly meta: Readonly<Record<string, unknown>>;
    readonly stats: CompileStats;
}
export interface CompileStats {
    readonly frameCount: number;
    readonly totalCells: number;
    readonly totalDiffOps: number;
    /** 0..1, fraction of cells skipped vs full redraw. */
    readonly compressionRatio: number;
    readonly compileMs: number;
}
/** Position cursor — analogous to pretext's LayoutCursor. */
export interface FrameCursor {
    readonly frameIndex: number;
}
/** Bounding box of non-transparent pixels for a single frame. */
export interface FrameBounds {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    /** True if the frame is fully transparent. */
    readonly empty: boolean;
}
/**
 * Compile a sprite source into a paint-ready, diff-compressed structure.
 *
 * This is the hot setup path. It validates input, builds the palette,
 * converts each frame to a packed Int8Array of palette indices, and
 * pre-computes inter-frame diff ops. Call it once per unique sprite —
 * paint*() functions are cheap on the result.
 */
export declare function compile(source: SpriteSource): CompiledSprite;
export declare const cursorStart: FrameCursor;
/** Advance a cursor by 1 frame, looping at the end. */
export declare function nextCursor(sprite: CompiledSprite, cursor: FrameCursor): FrameCursor;
/** Step a cursor by an arbitrary integer delta (positive or negative), with wrap-around. */
export declare function stepCursor(sprite: CompiledSprite, cursor: FrameCursor, delta: number): FrameCursor;
/**
 * Paint one frame into a 2D canvas context using the per-frame diff buffer.
 *
 * Clearing semantics:
 *   - `clearOnFirst: true` (default) clears the sprite's entire bbox on frame 0.
 *     Right for a single, stationary sprite — frames 1..N then paint diffs onto
 *     an already-correct previous frame.
 *   - `clearBefore: true` clears the sprite's bbox on EVERY paint, then paints
 *     the full grid (not the diff). Use this when the sprite moves or when other
 *     drawing happens between paints (multi-instance scenarios). Stateless and
 *     wrap-around safe at the cost of painting all opaque cells every frame.
 *   - `dx` / `dy` shift the paint origin within the destination context.
 *
 * Sprite-resolution coords; scale up via CSS `image-rendering: pixelated`.
 */
export declare function paintCanvas(ctx: CanvasRenderingContext2D, sprite: CompiledSprite, cursor: FrameCursor, options?: {
    clearOnFirst?: boolean;
    clearBefore?: boolean;
    dx?: number;
    dy?: number;
}): void;
/**
 * Paint a frame by `drawImage`-ing a pre-rasterized offscreen canvas.
 *
 * Trade-off vs `paintCanvas`:
 *   - `paintCanvas` walks per-frame diff ops (cheap when most cells are static)
 *   - `paintRaster` walks each frame's grid ONCE up front, then per-paint is
 *     a single GPU-accelerated `drawImage` call.
 *
 * Use `paintRaster` when:
 *   - You're rendering many instances of the same sprite (stress field, particle-
 *     style effects, sprite grids). One drawImage per instance scales much
 *     better than 50–500 fillRects per instance.
 *   - You move the sprite around (translate, transform) — drawImage handles this
 *     for free; diff-op painting would need to redraw the whole sprite anyway.
 *
 * Use `paintCanvas` (diff-op) when:
 *   - You have a single, stationary sprite where most cells stay constant
 *     between frames (e.g. dashboard widget, decorative animation).
 *   - You want to visualize *which* cells change per frame.
 *
 * The first paintRaster call for a given sprite rasterizes all frames eagerly
 * and caches them. Subsequent calls are a single drawImage. The cache is keyed
 * by sprite reference (WeakMap), so palette-swapped variants get their own
 * cache entry without invalidating the source.
 *
 * ⚠️ Palette swap interaction: `withPalette()` returns a fresh sprite reference,
 * which means the raster path pays a full re-rasterization on first paint after
 * a swap (~5–10ms for a 64×64×16-frame sprite). The "structure-shared palette
 * swap is microsecond" guarantee only applies to `paintCanvas` (diff-op). If
 * you swap palettes frequently while using `paintRaster`, call
 * `prerasterize(swapped)` after the swap to absorb the cost off the hot path,
 * or stick to `paintCanvas`.
 */
export declare function paintRaster(ctx: CanvasRenderingContext2D, sprite: CompiledSprite, cursor: FrameCursor, options?: {
    dx?: number;
    dy?: number;
    clearBefore?: boolean;
}): void;
/**
 * Eagerly raster every frame of `sprite` to per-frame offscreen canvases.
 * Useful for SSR-style preroll, or to surface rasterization cost up front
 * (default lazy behaviour spreads it over the first paintRaster call).
 */
export declare function prerasterize(sprite: CompiledSprite): void;
/** Drop the offscreen canvas cache for a sprite (e.g. after a custom palette mutation). */
export declare function clearRasterCache(sprite?: CompiledSprite): void;
export interface SVGRenderState {
    readonly rects: readonly SVGRectElement[];
    readonly width: number;
    readonly height: number;
}
/**
 * One-time SVG node setup. Allocates one <rect> per pixel and clears the host.
 * Sets viewBox + shape-rendering on the host. Call once per sprite/host pair;
 * paintSVG() is then cheap.
 */
export declare function prepareSVG(host: SVGSVGElement, sprite: CompiledSprite): SVGRenderState;
export declare function paintSVG(state: SVGRenderState, sprite: CompiledSprite, cursor: FrameCursor): void;
/**
 * Render a frame as a plain string with luminance-mapped block characters.
 * Useful for terminals, snapshots, debugging.
 */
export declare function renderAscii(sprite: CompiledSprite, cursor: FrameCursor): string;
/** Convenience for DOM hosts: writes ASCII into a <pre> via textContent. */
export declare function paintAscii(pre: HTMLElement, sprite: CompiledSprite, cursor: FrameCursor): void;
/** Compute the bounding box of non-transparent pixels in a single frame. */
export declare function measureFrameBounds(sprite: CompiledSprite, cursor: FrameCursor): FrameBounds;
/** Bounding box that contains every frame's non-transparent pixels. */
export declare function measureUnionBounds(sprite: CompiledSprite): FrameBounds;
/**
 * Return a new compiled sprite with the palette colors remapped, preserving
 * the diff ops and grids. Use to produce day/night/damaged variants without
 * recompiling. The mapping is keyed by char from the original SpriteSource;
 * unmapped chars keep their original color.
 *
 * This is cheap: the structural arrays are reused by reference.
 */
export declare function withPalette(sprite: CompiledSprite, originalSource: SpriteSource, remap: Readonly<Record<string, string>>): CompiledSprite;
export interface AnimatorOptions {
    /** Override the sprite's speed. */
    readonly speed?: number;
    /** Called after each paint with the just-drawn cursor. */
    readonly onTick?: (cursor: FrameCursor) => void;
}
export interface Animator {
    start(): void;
    stop(): void;
    isRunning(): boolean;
    cursor(): FrameCursor;
    /** Manually paint the current frame (e.g. after seek). */
    redraw(): void;
    /** Jump to a specific frame index without playing. */
    seek(frameIndex: number): void;
    /** Step backward/forward by N frames without playing. */
    step(delta: number): void;
}
/**
 * Bind a compiled sprite to one or more paint callbacks and drive playback.
 * Pass any number of paint fns — they all receive the same cursor on each tick.
 *
 *   const a = createAnimator(sprite, [
 *     c => paintCanvas(ctx, sprite, c),
 *     c => paintSVG(svgState, sprite, c),
 *   ]);
 *   a.start();
 */
export declare function createAnimator(sprite: CompiledSprite, paintFns: ReadonlyArray<(cursor: FrameCursor) => void>, options?: AnimatorOptions): Animator;
/** Result of importing an image: raw color grid, plus an auto-built SpriteSource. */
export interface ImportResult {
    readonly source: SpriteSource;
    readonly palette: Palette;
}
export interface ImportOptions {
    /** Max distinct colors. Extra colors get quantized to nearest. Default: 16. */
    readonly maxColors?: number;
    /** Alpha threshold (0..255) below which a pixel is treated as transparent. Default: 32. */
    readonly alphaThreshold?: number;
    /** Sprite-sheet rows. Default: 1. */
    readonly rows?: number;
    /** Sprite-sheet columns. Default: 1. */
    readonly cols?: number;
    /** Optional name for the sprite. */
    readonly name?: string;
}
/**
 * Convert an HTMLImageElement (or anything drawable to canvas) into a SpriteSource.
 * Slices the image into rows×cols frames, quantizes colors to a palette of
 * single-char keys, and produces a SpriteSource you can pass to compile().
 *
 * Quantization is naive nearest-neighbor median-cut-lite: counts unique colors,
 * keeps the top maxColors by frequency, and remaps the rest to the nearest.
 */
export declare function importImage(image: HTMLImageElement | HTMLCanvasElement, options?: ImportOptions): ImportResult;
/**
 * Compile with memoization. Pass a stable cacheKey (e.g. sprite name) to
 * reuse work across re-renders. Falls through to compile() on miss.
 */
export declare function compileMemo(cacheKey: string, source: SpriteSource): CompiledSprite;
export declare function clearCache(): void;
//# sourceMappingURL=pixelflow.d.ts.map