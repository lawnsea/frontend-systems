import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  BigInt64,
  Bool,
  type DataViewLike,
  DataViewSlice,
  defineStruct,
  Float32,
  Int16BE,
  type Init,
  type SliceMode,
  Uint8,
  Uint32,
} from './index.js';

class IsoDate {
  static readonly size = 8;
  static fromDataView(view: DataViewLike): Date {
    return new Date(view.getFloat64(0, true));
  }
  static toDataView(value: Date, view: DataViewLike): void {
    view.setFloat64(0, value.getTime(), true);
  }
}

function viewOf(size: number): DataView {
  return new DataView(new ArrayBuffer(size));
}

describe.each<SliceMode>(['movable', 'native'])('defineStruct with %s slices', (slices) => {
  const Position = defineStruct({ x: Float32, y: Float32, z: Float32 }, { name: 'Position', slices });
  const Fiz = defineStruct({ id: Uint32, on: Bool }, { name: 'Fiz', slices });
  const Thing = defineStruct({ x: Float32, y: Float32, foo: { bar: IsoDate }, fiz: Fiz }, { name: 'Thing', slices });

  it('packs fields in key order', () => {
    expect(Position.size).toBe(12);
    expect(Fiz.size).toBe(5);
    expect(Thing.size).toBe(4 + 4 + 8 + 5);
    expect(Position.name).toBe('Position');
  });

  it('reads and writes little-endian bytes at the start of a slice', () => {
    const view = viewOf(24);
    const p = Position.create(new DataViewSlice(new DataViewSlice(view, 4), 4));
    p.x = 1.5;
    p.z = -2;
    expect(view.getFloat32(8, true)).toBe(1.5);
    expect(view.getFloat32(16, true)).toBe(-2);
    view.setFloat32(12, 3, true);
    expect(p.y).toBe(3);
  });

  it('accepts a DataView with its own byteOffset', () => {
    const buffer = new ArrayBuffer(16);
    const p = Position.create(new DataView(buffer, 4));
    p.x = 7;
    expect(new DataView(buffer).getFloat32(4, true)).toBe(7);
  });

  it('supports big-endian and bigint codecs', () => {
    const S = defineStruct({ a: Int16BE, b: BigInt64, c: Uint8 }, { slices });
    const view = viewOf(S.size);
    const s = S.create(view);
    s.a = 0x0102;
    s.b = -5n;
    s.c = 255;
    expect(view.getUint8(0)).toBe(1);
    expect(view.getBigInt64(2, true)).toBe(-5n);
    expect(s.toJSON()).toEqual({ a: 0x0102, b: -5n, c: 255 });
  });

  it('views nested schemas and struct classes over the parent bytes', () => {
    const view = viewOf(Thing.size);
    const t = Thing.create(view);
    const when = new Date('2026-01-01T00:00:00Z');
    t.foo.bar = when;
    t.fiz.id = 23;
    t.fiz.on = true;
    expect(view.getFloat64(8, true)).toBe(when.getTime());
    expect(view.getUint32(16, true)).toBe(23);
    expect(view.getUint8(20)).toBe(1);
    expect(t.toJSON()).toEqual({ x: 0, y: 0, foo: { bar: when }, fiz: { id: 23, on: true } });
  });

  it('rejects assignment to nested fields', () => {
    const t = Thing.create(viewOf(Thing.size));
    // @ts-expect-error nested fields are read-only views
    expect(() => (t.fiz = t.fiz)).toThrow(TypeError);
  });

  it('writes plain objects and partial patches', () => {
    const view = viewOf(Thing.size);
    const value: Init<typeof Thing.schema> = {
      x: 1,
      y: 2,
      foo: { bar: new Date(0) },
      fiz: { id: 3, on: false },
    };
    Thing.toDataView(value, view);
    const t = Thing.fromDataView(view);
    expect(t.toJSON()).toEqual(value);
    t.set({ y: 9, fiz: { on: true } });
    expect(t.toJSON()).toEqual({ ...value, y: 9, fiz: { id: 3, on: true } });
  });

  it('copies one instance into another', () => {
    const a = Position.create(viewOf(12)).set({ x: 1, y: 2, z: 3 });
    const b = Position.create(viewOf(12)).set(a);
    expect(b.toJSON()).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('throws when the view is too small', () => {
    expect(() => Position.create(new DataViewSlice(viewOf(12), 4))).toThrow(RangeError);
    expect(() => Position.toDataView({ x: 0, y: 0, z: 0 }, viewOf(8))).toThrow(RangeError);
  });

  it('rejects reserved names and non-codec fields', () => {
    expect(() => defineStruct({ set: Uint8 }, { slices })).toThrow(/reserved/);
    expect(() => defineStruct({ a: 4 as never }, { slices })).toThrow(/expected a codec/);
  });

  describe('recycle', () => {
    it('reuses recycled instances', () => {
      const p = Position.create(viewOf(12));
      Position.recycle(p);
      const view = viewOf(24);
      const q = Position.create(new DataViewSlice(view, 12));
      expect(q).toBe(p);
      q.x = 4;
      expect(view.getFloat32(12, true)).toBe(4);
    });

    it('rebinds nested fields', () => {
      const t = Thing.create(viewOf(Thing.size));
      const fiz = t.fiz;
      Thing.recycle(t);
      const view = viewOf(Thing.size + 3);
      const u = Thing.create(new DataViewSlice(view, 3));
      expect(u.fiz).toBe(fiz);
      u.fiz.id = 1;
      expect(view.getUint32(3 + 16, true)).toBe(1);
    });

    it('makes use after recycle throw', () => {
      const t = Thing.create(viewOf(Thing.size));
      const fiz = t.fiz;
      Thing.recycle(t);
      expect(() => t.x).toThrow(/used after recycle/);
      expect(() => (fiz.id = 1)).toThrow(/used after recycle/);
      expect(() => Thing.recycle(t)).toThrow(/already recycled/);
    });

    it('refuses nested fields and foreign instances', () => {
      const t = Thing.create(viewOf(Thing.size));
      expect(() => Fiz.recycle(t.fiz)).toThrow(/Recycle the parent/);
      expect(() => Position.recycle(t as never)).toThrow(/expected an instance/);
    });
  });
});

describe('types', () => {
  it('infers field types from codecs', () => {
    const Fiz = defineStruct({ id: Uint32, on: Bool });
    const Thing = defineStruct({ x: Float32, y: Float32, foo: { bar: IsoDate }, fiz: Fiz });
    const t = Thing.create(viewOf(Thing.size));
    expectTypeOf(t.x).toEqualTypeOf<number>();
    expectTypeOf(t.foo.bar).toEqualTypeOf<Date>();
    expectTypeOf(t.fiz.on).toEqualTypeOf<boolean>();
    expectTypeOf(t.toJSON()).toEqualTypeOf<{
      x: number;
      y: number;
      foo: { bar: Date };
      fiz: { id: number; on: boolean };
    }>();
    type F = InstanceType<typeof Fiz>;
    expectTypeOf<F['id']>().toEqualTypeOf<number>();
    // @ts-expect-error wrong value type
    t.x = 'a';
  });
});
