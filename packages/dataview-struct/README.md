# dataview-struct

`dataview-struct` builds JavaScript classes whose fields read and write bytes in a [DataView](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView). TypeScript infers each instance's type from the schema. Instances can be returned to a per-class pool and reused.

```ts
import { defineStruct, Float32, Uint32, Bool } from 'dataview-struct';

const Position = defineStruct({ x: Float32, y: Float32, z: Float32 }, 'Position');
type Position = InstanceType<typeof Position>;

const view = new DataView(new ArrayBuffer(Position.size * 100));
const p = Position.create(view, 12); // the second position
p.x = 1.5; // writes 4 bytes at offset 12
Position.recycle(p); // p now throws on use; the next create() reuses it
```

## Schemas

A **schema** is a plain object mapping field names to field types. Fields are packed with no padding, in `Object.keys` order, so integer-like keys such as `"0"` move to the front.

A field type is one of:

- A **codec:** any object, typically a static class, with `size`, `fromDataView(view, byteOffset)`, and `toDataView(value, view, byteOffset)`.
- A struct class from `defineStruct`.
- A nested schema object, which becomes an anonymous struct class.

```ts
class IsoDate {
  static readonly size = 8;
  static fromDataView(view: DataView, byteOffset: number): Date {
    return new Date(view.getFloat64(byteOffset, true));
  }
  static toDataView(value: Date, view: DataView, byteOffset: number): void {
    view.setFloat64(byteOffset, value.getTime(), true);
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

Scalar fields read and write the DataView on every access. Nothing is cached. Nested fields are read-only: assigning `t.fiz = …` throws. Use `t.set({ fiz: { on: true } })` to write fields of a nested struct.

| Member | Behavior |
| --- | --- |
| `Struct.size` | Bytes one instance occupies. |
| `Struct.create(view, byteOffset = 0)` | Binds a pooled instance. Throws `RangeError` if the struct doesn't fit in the view. |
| `Struct.recycle(instance)` | Returns the instance to the pool. Any later use of it, or of its nested fields, throws. |
| `new Struct(view, byteOffset = 0)` | Binds an unpooled instance. |
| `Struct.fromDataView(view, byteOffset)` | Same as `create`, so a struct class works as a codec. |
| `Struct.toDataView(value, view, byteOffset)` | Writes a plain object or another instance. |
| `instance.set(patch)` | Writes each defined field of `patch` and returns the instance. |
| `instance.toJSON()` | Copies every field into a plain object. |

`set` and `toJSON` are reserved and can't be used as field names.

The pool has no size limit. It keeps every recycled instance until `create` reuses it.

## Performance

Run `pnpm bench` to reproduce. On Node 24 (Apple silicon), reading `x`, `y`, and `z` and writing `x` costs, per position:

| Approach | ns |
| --- | --- |
| Raw `DataView` calls | 1.6 |
| `defineStruct` accessors | 2.5 |
| `Proxy` over a DataView | 57 |
| `create` + `recycle` | 3.9 |
| `new` (unpooled) | 6.0 |

Each field has its own accessor on the class prototype. That keeps each call site monomorphic, so V8 can inline the codec. A [Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) trap can't be inlined, so this package doesn't use one.

## Development

- `pnpm build` compiles `src` to `dist`.
- `pnpm typecheck` typechecks `src`, including tests.
- `pnpm test` runs the unit tests with [Vitest](https://vitest.dev/).
- `pnpm bench` builds the package and runs `bench/access.js`.
