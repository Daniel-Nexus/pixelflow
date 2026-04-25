// Smoke test for non-DOM pieces of pixelflow.
import {
  compile,
  cursorStart,
  nextCursor,
  stepCursor,
  renderAscii,
  measureFrameBounds,
  measureUnionBounds,
  withPalette,
  compileMemo,
  clearCache,
} from '../src/pixelflow.js';

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('  ok:', msg);
}

// ---- Test 1: basic compile ----
console.log('\n[1] compile basics');
const src = {
  frames: [
    [
      "....RRRR....",
      "...RRRRRR...",
      "..RRRRRRRR..",
      "..RR....RR..",
    ],
    [
      ".....RR.....",
      "....RRRR....",
      "...RRRRRR...",
      "..RRRRRRRR..",
    ],
    [
      "....RRRR....",
      "...RRRRRR...",
      "..RRRRRRRR..",
      "..RR....RR..",
    ],
  ],
  palette: { R: '#dc2626' },
  speed: 100,
  name: 'test',
};
const sp = compile(src);
assert(sp.width === 12 && sp.height === 4, 'dims correct');
assert(sp.diffs.length === 3, 'frame count = 3');
assert(sp.palette[0] === 'transparent', 'palette[0] is transparent');
assert(sp.palette[1] === '#dc2626', 'palette[1] is red');
assert(sp.stats.frameCount === 3, 'stats.frameCount');
assert(sp.stats.totalCells === 12 * 4 * 3, 'stats.totalCells = w*h*frames');
assert(sp.stats.compressionRatio > 0, 'compressionRatio > 0 (frame 2 == frame 0)');
// frame 2 equals frame 0, but its prev is frame 1, so its diff is non-empty.
// Specifically: it should equal the diff of frame 1 -> frame 0 in reverse.
assert(sp.diffs[2].length > 0, 'frame 2 has non-empty diff (prev=frame1, content=frame0)');
assert(sp.diffs[2].length === sp.diffs[1].length, 'returning to identical state has same op count as the change that left it');

// ---- Test 2: cursor advance ----
console.log('\n[2] cursors');
let c = cursorStart;
assert(c.frameIndex === 0, 'cursorStart at 0');
c = nextCursor(sp, c);
assert(c.frameIndex === 1, 'next -> 1');
c = nextCursor(sp, c);
c = nextCursor(sp, c);
assert(c.frameIndex === 0, 'wrap at end');
c = stepCursor(sp, c, -1);
assert(c.frameIndex === 2, 'negative step wraps');
c = stepCursor(sp, c, 5);
assert(c.frameIndex === 1, '5 steps from 2 in mod 3 = 1');

// ---- Test 3: ascii render ----
console.log('\n[3] ascii');
const ascii = renderAscii(sp, { frameIndex: 0 });
const lines = ascii.split('\n').filter(l => l.length > 0);
assert(lines.length === 4, 'ascii has 4 lines');
assert(lines[0].length === 12, 'each line is 12 chars wide');
assert(lines[0].includes('░') || lines[0].includes('▒') || lines[0].includes('▓') || lines[0].includes('█'),
  'ascii contains a block char');
console.log('  preview:\n' + ascii.split('\n').map(l => '    ' + l).join('\n'));

// ---- Test 4: bounds ----
console.log('\n[4] bounds');
const b0 = measureFrameBounds(sp, { frameIndex: 0 });
assert(!b0.empty, 'frame 0 is non-empty');
assert(b0.x === 2 && b0.width === 8, `frame 0 starts at x=2 width=8 (got x=${b0.x} w=${b0.width})`);
const u = measureUnionBounds(sp);
assert(!u.empty, 'union is non-empty');
assert(u.width >= b0.width, 'union width >= any single frame');

// ---- Test 5: empty frame ----
console.log('\n[5] empty frame bounds');
const blank = compile({
  frames: [['....', '....']],
  palette: { X: '#000' },
});
const bb = measureFrameBounds(blank, { frameIndex: 0 });
assert(bb.empty, 'all-transparent frame is empty');

// ---- Test 6: theme swap ----
console.log('\n[6] theme swap');
const swapped = withPalette(sp, src, { R: '#3b82f6' });
assert(swapped.palette[1] === '#3b82f6', 'swapped color applied');
assert(swapped.diffs === sp.diffs, 'diffs reused by reference (cheap swap)');
assert(swapped.grids === sp.grids, 'grids reused by reference');

// ---- Test 7: cache ----
console.log('\n[7] memo cache');
clearCache();
const a = compileMemo('k1', src);
const b = compileMemo('k1', src);
assert(a === b, 'same key returns same compiled object');
const c2 = compileMemo('k2', src);
assert(c2 !== a, 'different key returns different object');
clearCache();

// ---- Test 8: validation errors ----
console.log('\n[8] validation');
try {
  compile({ frames: [], palette: {} });
  assert(false, 'should throw on empty frames');
} catch (e) {
  assert(e instanceof Error && e.message.includes('at least one frame'), 'rejects empty frames');
}
try {
  compile({ frames: [['ABC', 'AB']], palette: { A: '#fff', B: '#000', C: '#ccc' } });
  assert(false, 'should throw on uneven width');
} catch (e) {
  assert(e instanceof Error && e.message.includes('width'), 'rejects uneven row width');
}
try {
  compile({ frames: [['XX']], palette: { Y: '#fff' } });
  assert(false, 'should throw on unknown char');
} catch (e) {
  assert(e instanceof Error && e.message.includes('unknown char'), 'rejects unknown char');
}
try {
  compile({ frames: [['..']], palette: { '.': '#fff' } });
  assert(false, "should reject '.' in palette");
} catch (e) {
  assert(e instanceof Error && e.message.includes('reserved'), "rejects '.' as palette key");
}

// ---- Test 9: diff correctness ----
console.log('\n[9] diff op correctness');
// Frame 0: all R cells should be ops; frame N>0: only changed cells.
const f0Ops = sp.diffs[0];
let f0RCount = 0;
for (let i = 0; i < f0Ops.length; i += 3) {
  if (f0Ops[i + 2] === 1) f0RCount++;
}
// Count R chars in frame 0 manually.
let manualR = 0;
for (const row of src.frames[0]) for (const ch of row) if (ch === 'R') manualR++;
assert(f0RCount === manualR, `frame 0 op count (${f0RCount}) matches R count (${manualR})`);

console.log('\nall tests passed');
