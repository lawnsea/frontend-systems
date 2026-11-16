import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  BigInt64,
  Bool,
  defineStruct,
  Float32,
  Int16BE,
  Uint8,
  Uint32,
  type Init,
} from './index.js';

class IsoDate {
  static readonly size = 8;
  static fromDataView(view: DataView, byteOffset: number): Date {
    return new Date(view.getFloat64(byteOffset, true));
  }
  static toDataView(value: Date, view: DataView, byteOffset: number): void {
    view.setFloat64(byteOffset, value.getTime(), true);
  }
}

const Position = defineStruct({ x: Float32, y: Float32, z: Float32 }, 'Position');
const Fiz = defineStruct({ id: Uint32, on: Bool }, 'Fiz');
const Thing = defineStruct({ x: Float32, y: Float32, foo: { bar: IsoDate }, fiz: Fiz }, 'Thing');

function viewOf(size: number): DataView {
  return new DataView(new ArrayBuffer(size));
}

describe('defineStruct', () => {
  it('packs fields in key order', () => {
    expect(Position.size).toBe(12);
    expect(Fiz.size).toBe(5);
    expect(Thing.size).toBe(4 + 4 + 8 + 5);
    expect(Position.name).toBe('Position');
  });

  it('reads and writes little-endian bytes at the bound offset', () => {
    const view = viewOf(20);
    const p = Position.create(view, 8);
    p.x = 1.5;
    p.z = -2;
    expect(view.getFloat32(8, true)).toBe(1.5);
    expect(view.getFloat32(16, true)).toBe(-2);
    view.setFloat32(12, 3, true);
    expect(p.y).toBe(3);
  });

  it('supports big-endian and bigint codecs', () => {
    const S = defineStruct({ a: Int16BE, b: BigInt64, c: Uint8 });
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
    t.fiz.id = 7;
    t.fiz.on = true;
    expect(view.getFloat64(8, true)).toBe(when.getTime());
    expect(view.getUint32(16, true)).toBe(7);
    expect(view.getUint8(20)).toBe(1);
    expect(t.toJSON()).toEqual({ x: 0, y: 0, foo: { bar: when }, fiz: { id: 7, on: true } });
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
    Thing.toDataView(value, view, 0);
    const t = Thing.fromDataView(view, 0);
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
    expect(() => Position.create(viewOf(12), 4)).toThrow(RangeError);
    expect(() => Position.create(viewOf(12), -1)).toThrow(RangeError);
    expect(() => Position.toDataView({ x: 0, y: 0, z: 0 }, viewOf(8), 0)).toThrow(RangeError);
  });

  it('rejects reserved names and non-codec fields', () => {
    expect(() => defineStruct({ set: Uint8 })).toThrow(/reserved/);
    expect(() => defineStruct({ a: 4 as never })).toThrow(/expected a codec/);
  });
});

describe('recycle', () => {
  it('reuses recycled instances', () => {
    const p = Position.create(viewOf(12));
    Position.recycle(p);
    const view = viewOf(24);
    const q = Position.create(view, 12);
    expect(q).toBe(p);
    q.x = 4;
    expect(view.getFloat32(12, true)).toBe(4);
  });

  it('rebinds nested fields', () => {
    const t = Thing.create(viewOf(Thing.size));
    const fiz = t.fiz;
    Thing.recycle(t);
    const view = viewOf(Thing.size + 3);
    const u = Thing.create(view, 3);
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

describe('nested schemas', () => {
  it('share a class when field names and codecs match', () => {
    const A = defineStruct({ a: { bar: IsoDate, n: Uint8 } });
    const B = defineStruct({ b: Uint8, c: { bar: IsoDate, n: Uint8 }, d: { n: Uint8, bar: IsoDate } });
    const a = A.create(viewOf(A.size));
    const b = B.create(viewOf(B.size));
    expect(b.c.constructor).toBe(a.a.constructor);
    expect(b.d.constructor).not.toBe(a.a.constructor);
    expect(defineStruct({ e: { bar: Float32, n: Uint8 } }).create(viewOf(5)).e.constructor).not.toBe(
      a.a.constructor,
    );
  });

  it('return children to their own pool on recycle', () => {
    const t = Thing.create(viewOf(Thing.size));
    const fiz = t.fiz;
    Thing.recycle(t);
    const view = viewOf(Fiz.size);
    const f = Fiz.create(view);
    expect(f).toBe(fiz);
    f.id = 5;
    expect(view.getUint32(0, true)).toBe(5);
    Fiz.recycle(f);
  });

  it('throw when read through a recycled parent', () => {
    const t = Thing.create(viewOf(Thing.size));
    Thing.recycle(t);
    expect(() => t.fiz).toThrow(/used after recycle/);
  });

  it('write and read without creating a child', () => {
    const view = viewOf(Thing.size);
    const t = Thing.create(view).set({ fiz: { id: 9 }, foo: { bar: new Date(5) } });
    expect(view.getUint32(16, true)).toBe(9);
    expect(t.toJSON().foo.bar).toEqual(new Date(5));
  });
});

describe('types', () => {
  it('infers field types from codecs', () => {
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
    type P = InstanceType<typeof Position>;
    expectTypeOf<P['x']>().toEqualTypeOf<number>();
    // @ts-expect-error wrong value type
    t.x = 'a';
  });
});
