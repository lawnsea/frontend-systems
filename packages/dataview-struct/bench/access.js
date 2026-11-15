// Compares field access through defineStruct's prototype accessors with a Proxy over the same
// DataView. Run with `pnpm bench`.
import { defineStruct, Float32 } from '../dist/index.js';

const COUNT = 1000;
const ROUNDS = 2000;
const Position = defineStruct({ x: Float32, y: Float32, z: Float32 });
const view = new DataView(new ArrayBuffer(Position.size * COUNT));

const structs = Array.from({ length: COUNT }, (_, i) => Position.create(view, i * Position.size));

const OFFSETS = { x: 0, y: 4, z: 8 };
const proxies = Array.from({ length: COUNT }, (_, i) => {
  const base = i * Position.size;
  return new Proxy(
    {},
    {
      get: (_, key) => view.getFloat32(base + OFFSETS[key], true),
      set: (_, key, value) => {
        view.setFloat32(base + OFFSETS[key], value, true);
        return true;
      },
    },
  );
});

const cases = {
  'raw DataView': () => {
    for (let i = 0; i < COUNT; i++) {
      const o = i * 12;
      view.setFloat32(o, view.getFloat32(o, true) + view.getFloat32(o + 4, true) + view.getFloat32(o + 8, true), true);
    }
  },
  defineStruct: () => {
    for (let i = 0; i < COUNT; i++) {
      const p = structs[i];
      p.x = p.x + p.y + p.z;
    }
  },
  Proxy: () => {
    for (let i = 0; i < COUNT; i++) {
      const p = proxies[i];
      p.x = p.x + p.y + p.z;
    }
  },
  'create + recycle': () => {
    for (let i = 0; i < COUNT; i++) {
      const p = Position.create(view, i * Position.size);
      p.x = i;
      Position.recycle(p);
    }
  },
  'new (unpooled)': () => {
    for (let i = 0; i < COUNT; i++) {
      const p = new Position(view, i * Position.size);
      p.x = i;
    }
  },
};

console.log(`ns per element (${COUNT} elements, median of ${ROUNDS} rounds)`);
for (const [name, fn] of Object.entries(cases)) {
  for (let i = 0; i < ROUNDS; i++) fn();
  const samples = [];
  for (let i = 0; i < ROUNDS; i++) {
    const start = process.hrtime.bigint();
    fn();
    samples.push(Number(process.hrtime.bigint() - start) / COUNT);
  }
  samples.sort((a, b) => a - b);
  console.log(`${name.padEnd(18)} ${samples[ROUNDS >> 1].toFixed(2)}`);
}
