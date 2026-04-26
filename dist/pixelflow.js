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
// ===========================================================================
// compile() — one-time heavy work
// ===========================================================================
/**
 * Compile a sprite source into a paint-ready, diff-compressed structure.
 *
 * This is the hot setup path. It validates input, builds the palette,
 * converts each frame to a packed Int8Array of palette indices, and
 * pre-computes inter-frame diff ops. Call it once per unique sprite —
 * paint*() functions are cheap on the result.
 */
export function compile(source) {
    const t0 = now();
    const { frames, palette: srcPalette, speed = 100, name = 'sprite', meta = {} } = source;
    if (frames.length === 0)
        throw new Error('compile(): need at least one frame');
    const h = frames[0].length;
    if (h === 0)
        throw new Error('compile(): frames must have at least one row');
    const w = frames[0][0].length;
    if (w === 0)
        throw new Error('compile(): frames must have at least one column');
    // Validate dimensions are uniform.
    for (let f = 0; f < frames.length; f++) {
        const fr = frames[f];
        if (fr.length !== h) {
            throw new Error(`compile(): frame ${f} has height ${fr.length}, expected ${h}`);
        }
        for (let y = 0; y < h; y++) {
            if (fr[y].length !== w) {
                throw new Error(`compile(): frame ${f} row ${y} has width ${fr[y].length}, expected ${w}`);
            }
        }
    }
    // Build palette: '.' always = 0 = transparent.
    const palette = ['transparent'];
    const charToIdx = { '.': 0 };
    for (const ch of Object.keys(srcPalette)) {
        if (ch === '.') {
            throw new Error("compile(): '.' is reserved for transparent and cannot be in palette");
        }
        if (ch.length !== 1) {
            throw new Error(`compile(): palette keys must be single chars, got '${ch}'`);
        }
        charToIdx[ch] = palette.length;
        palette.push(srcPalette[ch]);
    }
    // Convert each frame to Int8Array of indices.
    const grids = [];
    for (let f = 0; f < frames.length; f++) {
        const grid = new Int8Array(w * h);
        const fr = frames[f];
        for (let y = 0; y < h; y++) {
            const row = fr[y];
            for (let x = 0; x < w; x++) {
                const ch = row[x];
                const idx = charToIdx[ch];
                if (idx === undefined) {
                    throw new Error(`compile(): frame ${f} (${x},${y}): unknown char '${ch}'. ` +
                        `Add it to the palette or use '.' for transparent.`);
                }
                grid[y * w + x] = idx;
            }
        }
        grids.push(grid);
    }
    // Compute diff ops.
    // Frame 0: every non-transparent cell is an op.
    // Frame N: every cell that differs from frame N-1.
    const diffs = [];
    let totalDiffOps = 0;
    for (let f = 0; f < grids.length; f++) {
        const cur = grids[f];
        const prev = f === 0 ? null : grids[f - 1];
        // First pass: count to size buffer exactly.
        let count = 0;
        for (let i = 0; i < cur.length; i++) {
            if (prev === null) {
                if (cur[i] !== 0)
                    count++;
            }
            else if (cur[i] !== prev[i]) {
                count++;
            }
        }
        const ops = new Int16Array(count * 3);
        let p = 0;
        for (let i = 0; i < cur.length; i++) {
            const changed = prev === null ? cur[i] !== 0 : cur[i] !== prev[i];
            if (changed) {
                ops[p++] = i % w;
                ops[p++] = (i / w) | 0;
                ops[p++] = cur[i];
            }
        }
        diffs.push(ops);
        totalDiffOps += count;
    }
    const totalCells = w * h * frames.length;
    const compressionRatio = totalCells === 0 ? 0 : 1 - totalDiffOps / totalCells;
    return {
        width: w,
        height: h,
        palette,
        diffs,
        grids,
        speed,
        name,
        meta,
        stats: {
            frameCount: frames.length,
            totalCells,
            totalDiffOps,
            compressionRatio,
            compileMs: now() - t0,
        },
    };
}
// ===========================================================================
// Cursors — pretext-style position abstraction
// ===========================================================================
export const cursorStart = Object.freeze({ frameIndex: 0 });
/** Advance a cursor by 1 frame, looping at the end. */
export function nextCursor(sprite, cursor) {
    return { frameIndex: (cursor.frameIndex + 1) % sprite.diffs.length };
}
/** Step a cursor by an arbitrary integer delta (positive or negative), with wrap-around. */
export function stepCursor(sprite, cursor, delta) {
    const n = sprite.diffs.length;
    const i = (((cursor.frameIndex + delta) % n) + n) % n;
    return { frameIndex: i };
}
// ===========================================================================
// Renderers — same compiled state, multiple paint targets
// ===========================================================================
// --- Canvas2D ---------------------------------------------------------------
/**
 * Paint one frame into a 2D canvas context. The canvas itself should be
 * sized to (sprite.width, sprite.height) — use CSS to scale up with
 * `image-rendering: pixelated`. Caller controls clearing semantics:
 * if you want a clean redraw on frame 0, pass `clearOnFirst: true`.
 */
export function paintCanvas(ctx, sprite, cursor, options = {}) {
    const { clearOnFirst = true } = options;
    const f = cursor.frameIndex;
    if (f === 0 && clearOnFirst)
        ctx.clearRect(0, 0, sprite.width, sprite.height);
    const ops = sprite.diffs[f];
    for (let i = 0; i < ops.length; i += 3) {
        const x = ops[i];
        const y = ops[i + 1];
        const c = ops[i + 2];
        if (c === 0) {
            ctx.clearRect(x, y, 1, 1);
        }
        else {
            ctx.fillStyle = sprite.palette[c];
            ctx.fillRect(x, y, 1, 1);
        }
    }
}
// --- Canvas2D (rasterized) --------------------------------------------------
/**
 * Cache of pre-rasterized per-frame offscreen canvases, keyed by sprite reference.
 * `withPalette()` returns a new sprite, so themed variants get their own cache
 * entry automatically without invalidating the original.
 */
const rasterCache = new WeakMap();
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
 */
export function paintRaster(ctx, sprite, cursor, options = {}) {
    let frames = rasterCache.get(sprite);
    if (!frames) {
        frames = rasterizeAllFrames(sprite);
        rasterCache.set(sprite, frames);
    }
    const { dx = 0, dy = 0, clearBefore = true } = options;
    if (clearBefore)
        ctx.clearRect(dx, dy, sprite.width, sprite.height);
    ctx.drawImage(frames[cursor.frameIndex], dx, dy);
}
/**
 * Eagerly raster every frame of `sprite` to per-frame offscreen canvases.
 * Useful for SSR-style preroll, or to surface rasterization cost up front
 * (default lazy behaviour spreads it over the first paintRaster call).
 */
export function prerasterize(sprite) {
    if (!rasterCache.has(sprite)) {
        rasterCache.set(sprite, rasterizeAllFrames(sprite));
    }
}
/** Drop the offscreen canvas cache for a sprite (e.g. after a custom palette mutation). */
export function clearRasterCache(sprite) {
    if (sprite)
        rasterCache.delete(sprite);
    // No way to clear all entries from a WeakMap — they GC when sprite refs drop.
}
function rasterizeAllFrames(sprite) {
    const out = [];
    const w = sprite.width, h = sprite.height;
    for (let f = 0; f < sprite.grids.length; f++) {
        const off = document.createElement('canvas');
        off.width = w;
        off.height = h;
        const octx = off.getContext('2d');
        if (!octx)
            throw new Error('paintRaster(): could not get 2D context for offscreen');
        octx.imageSmoothingEnabled = false;
        const grid = sprite.grids[f];
        for (let i = 0; i < grid.length; i++) {
            const c = grid[i];
            if (c === 0)
                continue;
            octx.fillStyle = sprite.palette[c];
            octx.fillRect(i % w, (i / w) | 0, 1, 1);
        }
        out.push(off);
    }
    return out;
}
const SVG_NS = 'http://www.w3.org/2000/svg';
/**
 * One-time SVG node setup. Allocates one <rect> per pixel and clears the host.
 * Sets viewBox + shape-rendering on the host. Call once per sprite/host pair;
 * paintSVG() is then cheap.
 */
export function prepareSVG(host, sprite) {
    while (host.firstChild)
        host.removeChild(host.firstChild);
    host.setAttribute('viewBox', `0 0 ${sprite.width} ${sprite.height}`);
    host.setAttribute('shape-rendering', 'crispEdges');
    const rects = new Array(sprite.width * sprite.height);
    for (let y = 0; y < sprite.height; y++) {
        for (let x = 0; x < sprite.width; x++) {
            const r = document.createElementNS(SVG_NS, 'rect');
            r.setAttribute('x', String(x));
            r.setAttribute('y', String(y));
            r.setAttribute('width', '1');
            r.setAttribute('height', '1');
            r.setAttribute('fill', 'transparent');
            host.appendChild(r);
            rects[y * sprite.width + x] = r;
        }
    }
    return { rects, width: sprite.width, height: sprite.height };
}
export function paintSVG(state, sprite, cursor) {
    if (state.width !== sprite.width || state.height !== sprite.height) {
        throw new Error('paintSVG(): SVG state size does not match sprite');
    }
    const ops = sprite.diffs[cursor.frameIndex];
    const w = sprite.width;
    for (let i = 0; i < ops.length; i += 3) {
        const x = ops[i];
        const y = ops[i + 1];
        const c = ops[i + 2];
        state.rects[y * w + x].setAttribute('fill', c === 0 ? 'transparent' : sprite.palette[c]);
    }
}
// --- ASCII ------------------------------------------------------------------
const ASCII_RAMP = [' ', '░', '▒', '▓', '█'];
/**
 * Render a frame as a plain string with luminance-mapped block characters.
 * Useful for terminals, snapshots, debugging.
 */
export function renderAscii(sprite, cursor) {
    const grid = sprite.grids[cursor.frameIndex];
    const w = sprite.width;
    const h = sprite.height;
    let out = '';
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const c = grid[y * w + x];
            if (c === 0) {
                out += ' ';
            }
            else {
                const lum = luminanceOf(sprite.palette[c]);
                const idx = Math.min(ASCII_RAMP.length - 1, Math.max(1, Math.round(lum * (ASCII_RAMP.length - 1))));
                out += ASCII_RAMP[idx];
            }
        }
        out += '\n';
    }
    return out;
}
/** Convenience for DOM hosts: writes ASCII into a <pre> via textContent. */
export function paintAscii(pre, sprite, cursor) {
    pre.textContent = renderAscii(sprite, cursor);
}
// ===========================================================================
// Inspection helpers — pretext's measureNaturalWidth analogue
// ===========================================================================
/** Compute the bounding box of non-transparent pixels in a single frame. */
export function measureFrameBounds(sprite, cursor) {
    const grid = sprite.grids[cursor.frameIndex];
    const w = sprite.width;
    const h = sprite.height;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (grid[y * w + x] !== 0) {
                if (x < minX)
                    minX = x;
                if (y < minY)
                    minY = y;
                if (x > maxX)
                    maxX = x;
                if (y > maxY)
                    maxY = y;
            }
        }
    }
    if (maxX < 0)
        return { x: 0, y: 0, width: 0, height: 0, empty: true };
    return {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        empty: false,
    };
}
/** Bounding box that contains every frame's non-transparent pixels. */
export function measureUnionBounds(sprite) {
    let minX = sprite.width, minY = sprite.height, maxX = -1, maxY = -1;
    for (let f = 0; f < sprite.diffs.length; f++) {
        const b = measureFrameBounds(sprite, { frameIndex: f });
        if (b.empty)
            continue;
        if (b.x < minX)
            minX = b.x;
        if (b.y < minY)
            minY = b.y;
        if (b.x + b.width - 1 > maxX)
            maxX = b.x + b.width - 1;
        if (b.y + b.height - 1 > maxY)
            maxY = b.y + b.height - 1;
    }
    if (maxX < 0)
        return { x: 0, y: 0, width: 0, height: 0, empty: true };
    return {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        empty: false,
    };
}
// ===========================================================================
// Theme swap — pretext's setLocale analogue
// ===========================================================================
/**
 * Return a new compiled sprite with the palette colors remapped, preserving
 * the diff ops and grids. Use to produce day/night/damaged variants without
 * recompiling. The mapping is keyed by char from the original SpriteSource;
 * unmapped chars keep their original color.
 *
 * This is cheap: the structural arrays are reused by reference.
 */
export function withPalette(sprite, originalSource, remap) {
    const charKeys = Object.keys(originalSource.palette);
    if (charKeys.length !== sprite.palette.length - 1) {
        throw new Error('withPalette(): original source palette size does not match compiled sprite');
    }
    const newPalette = sprite.palette.slice();
    for (let i = 0; i < charKeys.length; i++) {
        const ch = charKeys[i];
        if (ch in remap)
            newPalette[i + 1] = remap[ch];
    }
    return { ...sprite, palette: newPalette };
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
export function createAnimator(sprite, paintFns, options = {}) {
    const speed = options.speed ?? sprite.speed;
    let cur = cursorStart;
    let timer = null;
    function paintAll() {
        for (const fn of paintFns)
            fn(cur);
        options.onTick?.(cur);
    }
    return {
        start() {
            if (timer !== null)
                return;
            paintAll();
            timer = setInterval(() => {
                cur = nextCursor(sprite, cur);
                paintAll();
            }, speed);
        },
        stop() {
            if (timer !== null) {
                clearInterval(timer);
                timer = null;
            }
        },
        isRunning() {
            return timer !== null;
        },
        cursor() {
            return cur;
        },
        redraw() {
            paintAll();
        },
        seek(frameIndex) {
            cur = { frameIndex: ((frameIndex % sprite.diffs.length) + sprite.diffs.length) % sprite.diffs.length };
            paintAll();
        },
        step(delta) {
            cur = stepCursor(sprite, cur, delta);
            paintAll();
        },
    };
}
/**
 * Convert an HTMLImageElement (or anything drawable to canvas) into a SpriteSource.
 * Slices the image into rows×cols frames, quantizes colors to a palette of
 * single-char keys, and produces a SpriteSource you can pass to compile().
 *
 * Quantization is naive nearest-neighbor median-cut-lite: counts unique colors,
 * keeps the top maxColors by frequency, and remaps the rest to the nearest.
 */
export function importImage(image, options = {}) {
    const { maxColors = 16, alphaThreshold = 32, rows = 1, cols = 1, name = 'imported' } = options;
    const fullW = 'naturalWidth' in image ? image.naturalWidth : image.width;
    const fullH = 'naturalHeight' in image ? image.naturalHeight : image.height;
    if (fullW % cols !== 0 || fullH % rows !== 0) {
        throw new Error(`importImage(): image size ${fullW}×${fullH} not divisible by ${cols}×${rows} grid`);
    }
    const frameW = fullW / cols;
    const frameH = fullH / rows;
    // Draw to a temp canvas to get pixel data.
    const tmp = document.createElement('canvas');
    tmp.width = fullW;
    tmp.height = fullH;
    const tctx = tmp.getContext('2d');
    if (!tctx)
        throw new Error('importImage(): could not get 2D context');
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(image, 0, 0);
    const fullData = tctx.getImageData(0, 0, fullW, fullH).data;
    // Pass 1: histogram over opaque pixels.
    const hist = new Map();
    for (let i = 0; i < fullData.length; i += 4) {
        if (fullData[i + 3] < alphaThreshold)
            continue;
        const key = (fullData[i] << 16) | (fullData[i + 1] << 8) | fullData[i + 2];
        hist.set(key, (hist.get(key) ?? 0) + 1);
    }
    // Pick top-N colors by frequency.
    const sorted = Array.from(hist.entries()).sort((a, b) => b[1] - a[1]);
    const kept = sorted.slice(0, maxColors).map(([rgb]) => rgb);
    // Build palette with single-char keys: A..Z, a..z, 0..9.
    const keyChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    if (kept.length > keyChars.length) {
        throw new Error(`importImage(): too many colors (${kept.length}); raise maxColors handling`);
    }
    const palette = {};
    const rgbToChar = new Map();
    for (let i = 0; i < kept.length; i++) {
        const ch = keyChars[i];
        palette[ch] = rgbToHex(kept[i]);
        rgbToChar.set(kept[i], ch);
    }
    // Map each pixel to nearest kept color (or '.').
    function nearestChar(r, g, b) {
        let bestCh = '.';
        let bestDist = Infinity;
        for (let i = 0; i < kept.length; i++) {
            const rgb = kept[i];
            const dr = ((rgb >> 16) & 0xff) - r;
            const dg = ((rgb >> 8) & 0xff) - g;
            const db = (rgb & 0xff) - b;
            const d = dr * dr + dg * dg + db * db;
            if (d < bestDist) {
                bestDist = d;
                bestCh = keyChars[i];
            }
        }
        return bestCh;
    }
    // Slice into frames.
    const frames = [];
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const frame = [];
            for (let y = 0; y < frameH; y++) {
                let line = '';
                for (let x = 0; x < frameW; x++) {
                    const px = ((row * frameH + y) * fullW + (col * frameW + x)) * 4;
                    if (fullData[px + 3] < alphaThreshold) {
                        line += '.';
                    }
                    else {
                        const r = fullData[px], g = fullData[px + 1], b = fullData[px + 2];
                        const key = (r << 16) | (g << 8) | b;
                        line += rgbToChar.get(key) ?? nearestChar(r, g, b);
                    }
                }
                frame.push(line);
            }
            frames.push(frame);
        }
    }
    return {
        source: { frames, palette, name },
        palette,
    };
}
// ===========================================================================
// Cache — pretext's clearCache analogue
// ===========================================================================
const compileCache = new Map();
/**
 * Compile with memoization. Pass a stable cacheKey (e.g. sprite name) to
 * reuse work across re-renders. Falls through to compile() on miss.
 */
export function compileMemo(cacheKey, source) {
    const hit = compileCache.get(cacheKey);
    if (hit)
        return hit;
    const fresh = compile(source);
    compileCache.set(cacheKey, fresh);
    return fresh;
}
export function clearCache() {
    compileCache.clear();
}
// ===========================================================================
// Internals
// ===========================================================================
function now() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
function luminanceOf(cssColor) {
    if (cssColor === 'transparent')
        return 1;
    const m = cssColor.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (m) {
        const r = parseInt(m[1], 16);
        const g = parseInt(m[2], 16);
        const b = parseInt(m[3], 16);
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }
    return 0.5;
}
function rgbToHex(rgb) {
    const r = ((rgb >> 16) & 0xff).toString(16).padStart(2, '0');
    const g = ((rgb >> 8) & 0xff).toString(16).padStart(2, '0');
    const b = (rgb & 0xff).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
}
