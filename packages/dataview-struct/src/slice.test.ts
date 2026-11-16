import { describe, expect, it } from 'vitest';
import { DataViewSlice } from './index.js';

const slice = (parent: DataView | DataViewSlice, byteOffset?: number, byteLength?: number) =>
  new DataViewSlice(parent, byteOffset, byteLength);

describe('DataViewSlice', () => {
  it('offsets relative to its parent', () => {
    const buffer = new ArrayBuffer(16);
    const s = slice(new DataView(buffer, 8), 4, 2);
    s.setUint16(0, 420);
    const bytes = new Uint8Array(buffer);
    expect([bytes[12], bytes[13]]).toEqual([0x01, 0xa4]);
    expect(s.byteOffset).toBe(12);
    expect(s.byteLength).toBe(2);
    expect(s.buffer).toBe(buffer);
  });

  it('nests', () => {
    const buffer = new ArrayBuffer(16);
    const s = slice(slice(new DataView(buffer, 2), 3), 4, 4);
    s.setFloat32(0, 1.5, true);
    expect(new DataView(buffer).getFloat32(9, true)).toBe(1.5);
    expect(s.byteOffset).toBe(9);
  });

  it('defaults to the rest of the parent', () => {
    expect(slice(new DataView(new ArrayBuffer(16)), 6).byteLength).toBe(10);
  });

  it('throws when it would extend past its parent', () => {
    const view = new DataView(new ArrayBuffer(16), 0, 8);
    expect(() => slice(view, 4, 8)).toThrow(RangeError);
    expect(() => slice(view, -1, 2)).toThrow(RangeError);
  });

  it('throws on access outside the slice', () => {
    const s = slice(new DataView(new ArrayBuffer(16)), 4, 4);
    expect(() => s.getUint32(1)).toThrow(RangeError);
    expect(() => s.setUint8(4, 0)).toThrow(RangeError);
    expect(() => s.getInt8(-1)).toThrow(RangeError);
  });
});
