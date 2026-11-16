# dataview-struct

`dataview-struct` builds JavaScript classes whose fields read and write bytes in a [DataView](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView). TypeScript infers each instance's type from the schema. Instances can be returned to a per-class pool and reused.

```ts
import { DataViewSlice, defineStruct, Float32 } from 'dataview-struct';

const Position = defineStruct({ x: Float32, y: Float32, z: Float32 }, { name: 'Position' });
type Position = InstanceType<typeof Position>;

const view = new DataView(new ArrayBuffer(Position.size * 100));
const p = Position.create(new DataViewSlice(view, 12, Position.size)); // the second position
p.x = 1.5; // writes 4 bytes at offset 12
Position.recycle(p); // p now throws on use; the next create() reuses it
```

## Slices

A **DataViewSlice** is to a DataView what a DataView is to an ArrayBuffer: a window onto some of its bytes, addressed from 0.

```ts
const buffer = new ArrayBuffer(16);
const view = new DataView(buffer, 8);
const slice = new DataViewSlice(view, 4, 2);
slice.setUint16(0, 420); // writes bytes 12 and 13 of buffer
```

It has DataView's `get` and `set` methods, `buffer`, `byteOffset`, and `byteLength`. Access outside the slice throws `RangeError`. A slice of a slice points straight at the underlying DataView.

`sliceDataView(view, byteOffset, byteLength)` does the same with a native DataView over `view.buffer`. Native reads and writes are faster, but the view can't be moved to other bytes. See [Performance](#performance).

## Schemas

A **schema** is a plain object mapping field names to field types. Fields are packed with no padding, in `Object.keys` order, so integer-like keys such as `"0"` move to the front.

A field type is one of:

- A **codec:** any object, typically a static class, with `size`, `fromDataView(view)`, and `toDataView(value, view)`. `view` is a DataView or DataViewSlice that starts at the field.
- A struct class from `defineStruct`.
- A nested schema object, which becomes an anonymous struct class.

```ts
class IsoDate {
  static readonly size = 8;
  static fromDataView(view: DataViewLike): Date {
    return new Date(view.getFloat64(0, true));
  }
  static toDataView(value: Date, view: DataViewLike): void {
    view.setFloat64(0, value.getTime(), true);
  }
}

const Fiz = defineStruct({ id: Uint32, on: Bool });
const Thing = defineStruct({ x: Float32, y: Float32, foo: { bar: IsoDate }, fiz: Fiz });

const t = Thing.create(view);
t.foo.bar = new Date(); // t.foo is a view over bytes 8–15 of t
t.fiz.on = true;
```

Built-in codecs cover every DataView type: `Int8`, `Uint8`, `Bool`, `Int16`, `Uint16`, `Int32`, `Uint32`, `Float32`, `Float64`, `BigInt64`, and `BigUint64`. Multi-byte codecs are little-endian, and each has a big-endian `BE` variant such as `Float32BE`.

## Instances

Each scalar field has its own view of its bytes, and reads and writes it on every access. Nothing is cached. Nested fields are read-only: assigning `t.fiz = …` throws. Use `t.set({ fiz: { on: true } })` to write fields of a nested struct.

| Member | Behavior |
| --- | --- |
| `Struct.size` | Bytes one instance occupies. |
| `Struct.create(view)` | Binds a pooled instance to the first `size` bytes of `view`. Throws `RangeError` if `view` is smaller. |
| `Struct.recycle(instance)` | Returns the instance to the pool. Any later use of it, or of its nested fields, throws. |
| `new Struct(view)` | Binds an unpooled instance. |
| `Struct.fromDataView(view)` | Same as `create`, so a struct class works as a codec. |
| `Struct.toDataView(value, view)` | Writes a plain object or another instance. |
| `instance.set(patch)` | Writes each defined field of `patch` and returns the instance. |
| `instance.toJSON()` | Copies every field into a plain object. |

`set` and `toJSON` are reserved and can't be used as field names.

The pool has no size limit. It keeps every recycled instance until `create` reuses it.

`defineStruct(schema, { slices })` picks each field's view:

- `movable` (default): a `DataViewSlice` made once per instance and moved by `create`.
- `native`: a new native DataView per field on every `create`.

## Performance

Run `pnpm bench` to reproduce. Each case runs in a fresh process. Node 24, Apple silicon:

| Per `Position` (3 × Float32) | `movable` | `native` |
| --- | --- | --- |
| Read `x`, `y`, `z` and write `x` | 6.9 ns | 5.0 ns |
| `create` + write `x` + `recycle` | 20 ns | 119 ns |
| Garbage per `create` | 0 B | 264 B |
| GCs during 2M `create`s | 0 | 441 |
| Retained heap per instance | 304 B | 424 B |

| Per slice | `DataViewSlice` | `sliceDataView` |
| --- | --- | --- |
| Read 3 floats, write 1 | 3.4 ns | 2.1 ns |
| Construct | 4.8 ns | 34 ns |
| Retained heap | 48 B | 88 B |

The same access through raw DataView calls with offsets takes 1.6 ns.

Each field has its own accessor on the class prototype. That keeps each call site monomorphic, so V8 can inline the codec. A [Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) trap can't be inlined: the same access through a Proxy took 57 ns.

In these benchmarks each codec sees only one view type. A codec that sees both DataViews and DataViewSlices has polymorphic call sites, which V8 optimizes less well. The benchmarks don't measure that case.

## Development

- `pnpm build` compiles `src` to `dist`.
- `pnpm typecheck` typechecks `src`, including tests.
- `pnpm test` runs the unit tests with [Vitest](https://vitest.dev/).
- `pnpm bench` builds the package and runs `bench/run.js`.
