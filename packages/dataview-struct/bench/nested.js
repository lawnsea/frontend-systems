// Measures structs with nested fields: access latency, create/recycle cost, retained memory, and
// garbage. Each case runs in a fresh process.
//
// Usage: node bench/nested.js [dist directories to compare...]   (defaults to ../dist)
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GCProfiler } from 'node:v8';

const SELF = fileURLToPath(import.meta.url);
const COUNT = 1000;
const ROUNDS = 2000;
const MEMORY_COUNT = 200_000;

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

/** Retained heap bytes per object made by `make`. */
function retained(make) {
  const holder = new Array(MEMORY_COUNT).fill(null);
  globalThis.gc();
  globalThis.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < MEMORY_COUNT; i++) holder[i] = make(i);
  globalThis.gc();
  globalThis.gc();
  const bytes = (process.memoryUsage().heapUsed - before) / MEMORY_COUNT;
  // Keeps `holder` reachable until after the measurement.
  holder.length = 0;
  return bytes;
}

/** Collections while `fn` runs ROUNDS times, and bytes they reclaimed per element. */
function gcDuring(fn) {
  globalThis.gc();
  const profiler = new GCProfiler();
  profiler.start();
  for (let i = 0; i < ROUNDS; i++) fn();
  const { statistics } = profiler.stop();
  let gcUs = 0;
  let freed = 0;
  for (const { cost, beforeGC, afterGC } of statistics) {
    gcUs += cost;
    freed += beforeGC.heapStatistics.usedHeapSize - afterGC.heapStatistics.usedHeapSize;
  }
  return { gcs: statistics.length, gcMs: gcUs / 1000, garbageB: freed / (ROUNDS * COUNT) };
}

async function runCase(caseName, dist) {
  const { defineStruct, Float32, Uint32, Bool } = await import(pathToFileURL(resolve(dist, 'index.js')).href);
  const Fiz = defineStruct({ id: Uint32, on: Bool }, 'Fiz');
  const Thing = defineStruct({ x: Float32, y: Float32, foo: { a: Float32, b: Float32 }, fiz: Fiz }, 'Thing');
  const view = new DataView(new ArrayBuffer(Thing.size * COUNT));
  const live = () => Array.from({ length: COUNT }, (_, i) => Thing.create(view, i * Thing.size));

  const cases = {
    scalarAccess() {
      const things = live();
      return {
        ns: time(() => {
          for (let i = 0; i < COUNT; i++) {
            const t = things[i];
            t.x = t.x + t.y;
          }
        }),
      };
    },
    nestedAccess() {
      const things = live();
      return {
        ns: time(() => {
          for (let i = 0; i < COUNT; i++) {
            const t = things[i];
            t.foo.a = t.foo.b + t.fiz.id;
          }
        }),
      };
    },
    createUntouched() {
      const fn = () => {
        for (let i = 0; i < COUNT; i++) {
          const t = Thing.create(view, i * Thing.size);
          t.x = i;
          Thing.recycle(t);
        }
      };
      return { ns: time(fn), ...gcDuring(fn) };
    },
    createTouched() {
      const fn = () => {
        for (let i = 0; i < COUNT; i++) {
          const t = Thing.create(view, i * Thing.size);
          t.foo.a = i;
          t.fiz.id = i;
          Thing.recycle(t);
        }
      };
      return { ns: time(fn), ...gcDuring(fn) };
    },
    newUnpooled() {
      const fn = () => {
        for (let i = 0; i < COUNT; i++) {
          const t = new Thing(view, i * Thing.size);
          t.x = i;
        }
      };
      return { ns: time(fn), ...gcDuring(fn) };
    },
    memory() {
      return {
        untouchedB: retained((i) => Thing.create(view, (i % COUNT) * Thing.size)),
        touchedB: retained((i) => {
          const t = Thing.create(view, (i % COUNT) * Thing.size);
          t.foo.a;
          t.fiz.id;
          return t;
        }),
      };
    },
  };
  return cases[caseName]();
}

const CASES = ['scalarAccess', 'nestedAccess', 'createUntouched', 'createTouched', 'newUnpooled', 'memory'];

if (process.argv[2] === '--case') {
  console.log(JSON.stringify(await runCase(process.argv[3], process.argv[4])));
} else {
  const dists = process.argv.length > 2 ? process.argv.slice(2) : [fileURLToPath(new URL('../dist', import.meta.url))];
  console.log(`Node ${process.version}, ${process.arch}. Thing = { x, y: Float32, foo: { a, b: Float32 }, fiz: { id: Uint32, on: Bool } }`);
  for (const name of CASES) {
    console.log(`\n${name}`);
    for (const dist of dists) {
      const out = execFileSync(process.execPath, ['--expose-gc', SELF, '--case', name, dist], { encoding: 'utf8' });
      const cells = Object.entries(JSON.parse(out)).map(([k, v]) => `${k}=${Number.isInteger(v) ? v : v.toFixed(2)}`);
      console.log(`  ${dist.padEnd(40).slice(-40)}  ${cells.join('  ')}`);
    }
  }
}
