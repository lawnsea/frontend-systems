// Compares backing structs with a DataView against backing them with typed arrays over the same
// ArrayBuffer. Each case runs in a fresh process.
//
// defineStruct only passes its view to codecs and reads `view.byteLength`, so each typed-array
// backing is a codec set over a `{ byteLength, u8, u32, f32 }` object. No library change needed.
//
// - dataview: the built-in codecs.
// - aligned: Float32Array and Uint32Array indexes. Fields must be naturally aligned.
// - bytes: a Uint8Array with explicit byte order. Floats go through a 4-byte scratch buffer.
// - hybrid: aligned typed-array access when the offset allows it, otherwise bytes.
//
// Usage: node bench/backing.js   (checks the backings agree byte for byte, then times them)
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Bool, defineStruct, Float32, Float32BE, Uint8, Uint32 } from '../dist/index.js';

const SELF = fileURLToPath(import.meta.url);
const COUNT = 1000;
const ROUNDS = 2000;

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

// Typed arrays use the host's byte order. Every current JS engine host is little-endian, but the
// codecs check rather than assume.
const HOST_LE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

function bswap32(u) {
  return ((u & 0xff) << 24) | ((u & 0xff00) << 8) | ((u >>> 8) & 0xff00) | (u >>> 24);
}

const scratch = new ArrayBuffer(4);
const s8 = new Uint8Array(scratch);
const sf32 = new Float32Array(scratch);

// Reads 4 bytes into the scratch float. `le` is the field's byte order.
function bytesToF32(b, o, le) {
  if (le === HOST_LE) {
    s8[0] = b[o];
    s8[1] = b[o + 1];
    s8[2] = b[o + 2];
    s8[3] = b[o + 3];
  } else {
    s8[0] = b[o + 3];
    s8[1] = b[o + 2];
    s8[2] = b[o + 1];
    s8[3] = b[o];
  }
  return sf32[0];
}

function f32ToBytes(v, b, o, le) {
  sf32[0] = v;
  if (le === HOST_LE) {
    b[o] = s8[0];
    b[o + 1] = s8[1];
    b[o + 2] = s8[2];
    b[o + 3] = s8[3];
  } else {
    b[o + 3] = s8[0];
    b[o + 2] = s8[1];
    b[o + 1] = s8[2];
    b[o] = s8[3];
  }
}

const sharedU32 = new Uint32Array(scratch);

const aligned = {
  Float32: {
    size: 4,
    fromDataView: HOST_LE ? (m, o) => m.f32[o >> 2] : (m, o) => ((sharedU32[0] = bswap32(m.u32[o >> 2])), sf32[0]),
    toDataView: HOST_LE
      ? (v, m, o) => {
          m.f32[o >> 2] = v;
        }
      : (v, m, o) => {
          sf32[0] = v;
          m.u32[o >> 2] = bswap32(sharedU32[0]);
        },
  },
  Float32BE: {
    size: 4,
    fromDataView: HOST_LE ? (m, o) => ((sharedU32[0] = bswap32(m.u32[o >> 2])), sf32[0]) : (m, o) => m.f32[o >> 2],
    toDataView: HOST_LE
      ? (v, m, o) => {
          sf32[0] = v;
          m.u32[o >> 2] = bswap32(sharedU32[0]);
        }
      : (v, m, o) => {
          m.f32[o >> 2] = v;
        },
  },
  Uint32: {
    size: 4,
    fromDataView: HOST_LE ? (m, o) => m.u32[o >> 2] : (m, o) => bswap32(m.u32[o >> 2]) >>> 0,
    toDataView: HOST_LE
      ? (v, m, o) => {
          m.u32[o >> 2] = v;
        }
      : (v, m, o) => {
          m.u32[o >> 2] = bswap32(v);
        },
  },
  Bool: {
    size: 1,
    fromDataView: (m, o) => m.u8[o] !== 0,
    toDataView: (v, m, o) => {
      m.u8[o] = v ? 1 : 0;
    },
  },
  Uint8: {
    size: 1,
    fromDataView: (m, o) => m.u8[o],
    toDataView: (v, m, o) => {
      m.u8[o] = v;
    },
  },
};

const bytes = {
  Float32: {
    size: 4,
    fromDataView: (m, o) => bytesToF32(m.u8, o, true),
    toDataView: (v, m, o) => f32ToBytes(v, m.u8, o, true),
  },
  Float32BE: {
    size: 4,
    fromDataView: (m, o) => bytesToF32(m.u8, o, false),
    toDataView: (v, m, o) => f32ToBytes(v, m.u8, o, false),
  },
  Uint32: {
    size: 4,
    fromDataView: (m, o) => {
      const b = m.u8;
      return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
    },
    toDataView: (v, m, o) => {
      const b = m.u8;
      b[o] = v;
      b[o + 1] = v >>> 8;
      b[o + 2] = v >>> 16;
      b[o + 3] = v >>> 24;
    },
  },
  Bool: aligned.Bool,
  Uint8: aligned.Uint8,
};

const hybrid = {
  Float32: {
    size: 4,
    fromDataView: (m, o) => ((o & 3) === 0 ? aligned.Float32.fromDataView(m, o) : bytes.Float32.fromDataView(m, o)),
    toDataView: (v, m, o) => {
      if ((o & 3) === 0) aligned.Float32.toDataView(v, m, o);
      else bytes.Float32.toDataView(v, m, o);
    },
  },
  Float32BE: {
    size: 4,
    fromDataView: (m, o) => ((o & 3) === 0 ? aligned.Float32BE.fromDataView(m, o) : bytes.Float32BE.fromDataView(m, o)),
    toDataView: (v, m, o) => {
      if ((o & 3) === 0) aligned.Float32BE.toDataView(v, m, o);
      else bytes.Float32BE.toDataView(v, m, o);
    },
  },
  Uint32: {
    size: 4,
    fromDataView: (m, o) => ((o & 3) === 0 ? aligned.Uint32.fromDataView(m, o) : bytes.Uint32.fromDataView(m, o)),
    toDataView: (v, m, o) => {
      if ((o & 3) === 0) aligned.Uint32.toDataView(v, m, o);
      else bytes.Uint32.toDataView(v, m, o);
    },
  },
  Bool: aligned.Bool,
  Uint8: aligned.Uint8,
};

const BACKINGS = {
  dataview: {
    codecs: { Float32, Float32BE, Uint32, Bool, Uint8 },
    memory: (buffer) => new DataView(buffer),
  },
  aligned: { codecs: aligned, memory: typedMemory },
  bytes: { codecs: bytes, memory: typedMemory },
  hybrid: { codecs: hybrid, memory: typedMemory },
};

function typedMemory(buffer) {
  return {
    byteLength: buffer.byteLength,
    u8: new Uint8Array(buffer),
    u32: new Uint32Array(buffer, 0, buffer.byteLength >> 2),
    f32: new Float32Array(buffer, 0, buffer.byteLength >> 2),
  };
}

function runCase(caseName, backingName) {
  const { codecs: c, memory } = BACKINGS[backingName];
  const Position = defineStruct({ x: c.Float32, y: c.Float32, z: c.Float32 });
  const PositionBE = defineStruct({ x: c.Float32BE, y: c.Float32BE, z: c.Float32BE });
  const Fiz = defineStruct({ id: c.Uint32, on: c.Bool });
  // 24 bytes, so every Thing and every field is naturally aligned.
  const Thing = defineStruct({ x: c.Float32, y: c.Float32, foo: { a: c.Float32, b: c.Float32 }, fiz: Fiz, pad: { p: c.Uint8, q: c.Uint8, r: c.Uint8 } });
  // 21 bytes, packed: odd elements and their fields are misaligned.
  const PackedThing = defineStruct({ x: c.Float32, y: c.Float32, foo: { a: c.Float32, b: c.Float32 }, fiz: Fiz });

  const instances = (Struct) => {
    const m = memory(new ArrayBuffer(Struct.size * COUNT + 8));
    return Array.from({ length: COUNT }, (_, i) => Struct.create(m, i * Struct.size));
  };
  const position = (Struct) => {
    const ps = instances(Struct);
    return time(() => {
      for (let i = 0; i < COUNT; i++) {
        const p = ps[i];
        p.x = p.x + p.y + p.z;
      }
    });
  };
  const thing = (Struct) => {
    const ts = instances(Struct);
    return time(() => {
      for (let i = 0; i < COUNT; i++) {
        const t = ts[i];
        t.x = t.y + t.foo.a + t.foo.b + t.fiz.id;
        t.fiz.on = !t.fiz.on;
      }
    });
  };

  const cases = {
    position: () => position(Position),
    positionBE: () => position(PositionBE),
    thingAligned: () => thing(Thing),
    thingPacked: () => thing(PackedThing),
  };
  return { ns: cases[caseName]() };
}

const CASES = {
  position: ['dataview', 'aligned', 'bytes', 'hybrid'],
  positionBE: ['dataview', 'aligned', 'bytes', 'hybrid'],
  thingAligned: ['dataview', 'aligned', 'bytes', 'hybrid'],
  // Aligned typed arrays can't address misaligned fields.
  thingPacked: ['dataview', 'bytes', 'hybrid'],
};

// Writes the same values through each backing and checks the bytes match the DataView backing,
// so the timings compare equivalent code.
function verify() {
  const results = {};
  for (const [name, { codecs: c, memory }] of Object.entries(BACKINGS)) {
    const Fiz = defineStruct({ id: c.Uint32, on: c.Bool });
    const S = defineStruct({ x: c.Float32, y: c.Float32BE, fiz: Fiz });
    const buffer = new ArrayBuffer(S.size * 4 + 8);
    const m = memory(buffer);
    // Offsets 0 and 16 are aligned; 1 and 7 aren't.
    const offsets = name === 'aligned' ? [0, 16] : [0, 1, 7, 16];
    for (const o of offsets) {
      const s = S.create(m, o);
      s.set({ x: 1.5 + o, y: -2.25 - o, fiz: { id: 0xdeadbeef - o, on: true } });
      const back = s.toJSON();
      if (back.x !== 1.5 + o || back.y !== -2.25 - o || back.fiz.id !== 0xdeadbeef - o || !back.fiz.on) {
        throw new Error(`${name}: read back ${JSON.stringify(back)} at offset ${o}`);
      }
    }
    results[name] = { offsets, bytes: Array.from(new Uint8Array(buffer)) };
  }
  const expected = results.dataview.bytes;
  for (const [name, { offsets, bytes }] of Object.entries(results)) {
    const reference = new Uint8Array(expected.length);
    // Rebuild DataView bytes for only the offsets this backing wrote.
    const S = defineStruct({ x: Float32, y: Float32BE, fiz: defineStruct({ id: Uint32, on: Bool }) });
    const v = new DataView(reference.buffer);
    for (const o of offsets) S.create(v, o).set({ x: 1.5 + o, y: -2.25 - o, fiz: { id: 0xdeadbeef - o, on: true } });
    if (bytes.some((b, i) => b !== reference[i])) throw new Error(`${name}: bytes differ from DataView`);
  }
  console.log('verify: every backing writes the same bytes as DataView');
}

if (process.argv[2] === '--verify') {
  verify();
} else if (process.argv[2] === '--case') {
  console.log(JSON.stringify(runCase(process.argv[3], process.argv[4])));
} else {
  verify();
  console.log(`Node ${process.version}, ${process.arch}, host ${HOST_LE ? 'little' : 'big'}-endian. ns per element.`);
  for (const [name, backings] of Object.entries(CASES)) {
    console.log(`\n${name}`);
    for (const backing of backings) {
      const out = execFileSync(process.execPath, [SELF, '--case', name, backing], { encoding: 'utf8' });
      console.log(`  ${backing.padEnd(9)} ${JSON.parse(out).ns.toFixed(2)}`);
    }
  }
}
