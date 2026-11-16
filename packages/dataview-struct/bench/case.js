// Runs one benchmark case for one slice mode and prints its results as JSON.
// Usage: node --expose-gc bench/case.js <case> <mode>
// `bench/run.js` runs every case in a fresh process so one mode's JIT feedback can't slow another.
import { GCProfiler } from 'node:v8';
import { DataViewSlice, defineStruct, Float32, sliceDataView } from '../dist/index.js';

const [caseName, mode] = process.argv.slice(2);
const COUNT = 1000;
const ROUNDS = 2000;
const MEMORY_COUNT = 1_000_000;

/** Median nanoseconds per element of `fn`, which processes COUNT elements. */
function time(fn) {
  for (let i = 0; i < ROUNDS; i++) fn();
  const samples = [];
  for (let i = 0; i < ROUNDS; i++) {
    const start = process.hrtime.bigint();
    fn();
    samples.push(Number(process.hrtime.bigint() - start) / COUNT);
  }
  samples.sort((a, b) => a - b);
  return samples[ROUNDS >> 1];
}

/** Retained heap bytes per object made by `make`, net of the array slot holding it. */
function retained(make) {
  const holder = new Array(MEMORY_COUNT).fill(null);
  globalThis.gc();
  globalThis.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < MEMORY_COUNT; i++) holder[i] = make(i);
  globalThis.gc();
  globalThis.gc();
  const bytes = (process.memoryUsage().heapUsed - before) / MEMORY_COUNT;
  holder.length = 0;
  return bytes;
}

/**
 * Garbage collections while `fn` runs `rounds` times, and the bytes they reclaimed per element,
 * which approximates bytes allocated per element.
 */
function gcDuring(fn, rounds) {
  globalThis.gc();
  const profiler = new GCProfiler();
  profiler.start();
  const start = process.hrtime.bigint();
  for (let i = 0; i < rounds; i++) fn();
  const wallMs = Number(process.hrtime.bigint() - start) / 1e6;
  const { statistics } = profiler.stop();
  let gcUs = 0;
  let freed = 0;
  for (const { cost, beforeGC, afterGC } of statistics) {
    gcUs += cost;
    freed += beforeGC.heapStatistics.usedHeapSize - afterGC.heapStatistics.usedHeapSize;
  }
  return {
    gcCount: statistics.length,
    gcMs: gcUs / 1000,
    wallMs,
    garbageBytes: freed / (rounds * COUNT),
  };
}

const POSITION = 12;
const view = new DataView(new ArrayBuffer(POSITION * COUNT));
const makeSlice = {
  raw: (offset, length) => ({ offset, length }),
  movable: (offset, length) => new DataViewSlice(view, offset, length),
  native: (offset, length) => sliceDataView(view, offset, length),
}[mode];

const cases = {
  // Read three floats and write one through a 12-byte slice per position.
  async sliceAccess() {
    if (mode === 'raw') {
      return {
        ns: time(() => {
          for (let i = 0; i < COUNT; i++) {
            const o = i * POSITION;
            view.setFloat32(o, view.getFloat32(o, true) + view.getFloat32(o + 4, true) + view.getFloat32(o + 8, true), true);
          }
        }),
      };
    }
    const slices = Array.from({ length: COUNT }, (_, i) => makeSlice(i * POSITION, POSITION));
    return {
      ns: time(() => {
        for (let i = 0; i < COUNT; i++) {
          const s = slices[i];
          s.setFloat32(0, s.getFloat32(0, true) + s.getFloat32(4, true) + s.getFloat32(8, true), true);
        }
      }),
    };
  },

  async sliceConstruct() {
    const sink = new Array(COUNT);
    const fn = () => {
      for (let i = 0; i < COUNT; i++) sink[i] = makeSlice(i * POSITION, POSITION);
    };
    return { ns: time(fn), bytes: retained((i) => makeSlice((i % COUNT) * POSITION, POSITION)), ...gcDuring(fn, ROUNDS) };
  },

  async structAccess() {
    const Position = defineStruct({ x: Float32, y: Float32, z: Float32 }, { slices: mode });
    const structs = Array.from({ length: COUNT }, (_, i) => Position.create(new DataViewSlice(view, i * POSITION, POSITION)));
    return {
      ns: time(() => {
        for (let i = 0; i < COUNT; i++) {
          const p = structs[i];
          p.x = p.x + p.y + p.z;
        }
      }),
    };
  },

  // Bind a pooled Position to each element, write one field, and recycle it.
  async structCreate() {
    const Position = defineStruct({ x: Float32, y: Float32, z: Float32 }, { slices: mode });
    const windows = Array.from({ length: COUNT }, (_, i) => new DataViewSlice(view, i * POSITION, POSITION));
    const fn = () => {
      for (let i = 0; i < COUNT; i++) {
        const p = Position.create(windows[i]);
        p.x = i;
        Position.recycle(p);
      }
    };
    return { ns: time(fn), ...gcDuring(fn, ROUNDS) };
  },

  async structMemory() {
    const Position = defineStruct({ x: Float32, y: Float32, z: Float32 }, { slices: mode });
    const Thing = defineStruct({ a: Float32, b: { c: Float32, d: Float32 } }, { slices: mode });
    const big = new DataView(new ArrayBuffer(POSITION));
    return {
      positionBytes: retained(() => Position.create(big)),
      nestedBytes: retained(() => Thing.create(big)),
    };
  },
};

console.log(JSON.stringify(await cases[caseName]()));
