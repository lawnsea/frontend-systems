import type { Codec } from './codecs.js';
import { baseOf, type DataViewLike, makeSlice, RECYCLED, rebind, rootOf } from './slice.js';

/**
 * **Schema:** a plain object mapping field names to codecs, struct classes, or nested schemas.
 * Fields are packed with no padding, in `Object.keys` order.
 */
export interface Schema {
  readonly [key: string]: Codec<unknown> | Schema;
}

// Matching struct classes by their `schema` rather than by `StructClass` avoids a type cycle.
interface StructLike<S extends Schema> {
  readonly schema: S;
}

type FieldValue<F> =
  F extends StructLike<infer N>
    ? Struct<N>
    : F extends Codec<infer T>
      ? T
      : F extends Schema
        ? Struct<F>
        : never;

type NestedKeys<S extends Schema> = {
  [K in keyof S]: S[K] extends StructLike<Schema> ? K : S[K] extends Codec<unknown> ? never : K;
}[keyof S];

/** Plain values for every field of `S`, as accepted by `toDataView` and returned by `toJSON`. */
export type Init<S extends Schema> = {
  -readonly [K in keyof S]: S[K] extends StructLike<infer N>
    ? Init<N>
    : S[K] extends Codec<infer T>
      ? T
      : S[K] extends Schema
        ? Init<S[K]>
        : never;
};

/** Values for some fields of `S`, as accepted by `set`. */
export type Patch<S extends Schema> = {
  [K in keyof S]?: S[K] extends StructLike<infer N>
    ? Patch<N>
    : S[K] extends Codec<infer T>
      ? T
      : S[K] extends Schema
        ? Patch<S[K]>
        : never;
};

/**
 * An instance of a struct class. Scalar fields read and write the DataView on every access.
 * Nested fields are read-only views over a region of the parent's bytes.
 */
export type Struct<S extends Schema> = {
  -readonly [K in Exclude<keyof S, NestedKeys<S>>]: FieldValue<S[K]>;
} & {
  readonly [K in NestedKeys<S>]: FieldValue<S[K]>;
} & {
  /** Writes each defined field of `values`. Returns `this`. */
  set(values: Patch<S>): Struct<S>;
  /** Copies every field into a plain object. */
  toJSON(): Init<S>;
};

export interface StructClass<S extends Schema> {
  /** Binds a new, unpooled instance to the start of `view`. Prefer `create`. */
  new (view: DataViewLike): Struct<S>;
  readonly schema: S;
  /** Bytes one instance occupies. */
  readonly size: number;
  /** Binds a pooled instance to the first `size` bytes of `view`. */
  create(view: DataViewLike): Struct<S>;
  /** Returns an instance from `create` to the pool. Any later use of it throws. */
  recycle(instance: Struct<S>): void;
  /** Same as `create`. Recycle the result when done with it. */
  fromDataView(view: DataViewLike): Struct<S>;
  /** Writes each defined field of `value`, so it may be a plain object or another instance. */
  toDataView(value: Init<S>, view: DataViewLike): void;
}

/**
 * How an instance gives each scalar field a view of its bytes.
 *
 * - `movable`: one `DataViewSlice` per field, made once per instance and moved by `create`.
 * - `native`: a new native `DataView` per field on every `create`.
 */
export type SliceMode = 'movable' | 'native';

export interface StructOptions {
  /** Class name, used in error messages. Defaults to `Struct`. */
  name?: string;
  /** Defaults to `movable`. Nested schemas inherit it. */
  slices?: SliceMode;
}

const FIELDS = Symbol('fields');
const CHILDREN = Symbol('children');
const OWNED = Symbol('owned');
const LIVE = Symbol('live');
const BIND = Symbol('bind');
const UNBIND = Symbol('unbind');

const RESERVED = new Set(['set', 'toJSON', 'constructor', '__proto__']);

interface Field {
  key: string;
  byteOffset: number;
  codec: Codec<unknown>;
  /** Index into `FIELDS` for scalars, or into `CHILDREN` for nested structs. */
  index: number;
  nested: boolean;
}

interface Internal {
  [FIELDS]: DataViewLike[];
  [CHILDREN]: Internal[];
  [OWNED]: boolean;
  [LIVE]: boolean;
}

interface InternalClass {
  new (): Internal;
  [BIND](instance: Internal, root: DataView, base: number): void;
  [UNBIND](instance: Internal): void;
}

function isCodec(value: unknown): value is Codec<unknown> {
  return (
    (typeof value === 'function' || (typeof value === 'object' && value !== null)) &&
    typeof (value as Codec<unknown>).fromDataView === 'function' &&
    typeof (value as Codec<unknown>).toDataView === 'function'
  );
}

function isPlainObject(value: unknown): value is Schema {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isStructClass(value: unknown): value is InternalClass {
  return typeof value === 'function' && BIND in value;
}

/**
 * Builds a class whose instances read and write `schema`'s fields in a caller-supplied DataView
 * or DataViewSlice.
 *
 * ```ts
 * const Position = defineStruct({ x: Float32, y: Float32, z: Float32 });
 * const p = Position.create(new DataViewSlice(view, 12, Position.size));
 * p.x = 1;
 * Position.recycle(p);
 * ```
 */
export function defineStruct<S extends Schema>(schema: S, options: StructOptions = {}): StructClass<S> {
  const { name = 'Struct', slices = 'movable' } = options;
  const scalars: Field[] = [];
  const nested: Field[] = [];
  const fields: Field[] = [];
  let size = 0;

  for (const key of Object.keys(schema)) {
    if (RESERVED.has(key)) {
      throw new TypeError(`${name}: field name "${key}" is reserved. Rename the field.`);
    }
    let codec = schema[key] as unknown;
    if (!isCodec(codec)) {
      if (!isPlainObject(codec)) {
        throw new TypeError(
          `${name}.${key}: expected a codec (with size, fromDataView, and toDataView) or a nested schema object.`,
        );
      }
      codec = defineStruct(codec, { name: `${name}.${key}`, slices });
    }
    const { size: fieldSize } = codec as Codec<unknown>;
    if (!Number.isInteger(fieldSize) || fieldSize < 0) {
      throw new TypeError(`${name}.${key}: codec size must be a non-negative integer, got ${fieldSize}.`);
    }
    const isNested = isStructClass(codec);
    const group = isNested ? nested : scalars;
    const field = {
      key,
      byteOffset: size,
      codec: codec as Codec<unknown>,
      index: group.length,
      nested: isNested,
    };
    group.push(field);
    fields.push(field);
    size += fieldSize;
  }

  const pool: StructImpl[] = [];

  function checkSize(view: DataViewLike): void {
    if (view.byteLength < size) {
      throw new RangeError(`${name}: needs ${size} bytes, but the view is ${view.byteLength} bytes.`);
    }
  }

  // `root` is a native DataView and `base` is the struct's offset within it.
  const bind =
    slices === 'movable'
      ? (instance: Internal, root: DataView, base: number): void => {
          const views = instance[FIELDS];
          for (let i = 0; i < scalars.length; i++) {
            const { byteOffset, codec } = scalars[i]!;
            rebind(views[i] as never, root, base + byteOffset, codec.size);
          }
          bindChildren(instance, root, base);
        }
      : (instance: Internal, root: DataView, base: number): void => {
          const views = instance[FIELDS];
          const start = root.byteOffset + base;
          for (let i = 0; i < scalars.length; i++) {
            const { byteOffset, codec } = scalars[i]!;
            views[i] = new DataView(root.buffer, start + byteOffset, codec.size);
          }
          bindChildren(instance, root, base);
        };

  function bindChildren(instance: Internal, root: DataView, base: number): void {
    instance[LIVE] = true;
    const children = instance[CHILDREN];
    for (let i = 0; i < nested.length; i++) {
      (nested[i]!.codec as unknown as InternalClass)[BIND](children[i]!, root, base + nested[i]!.byteOffset);
    }
  }

  function unbind(instance: Internal): void {
    instance[LIVE] = false;
    const views = instance[FIELDS];
    for (let i = 0; i < scalars.length; i++) {
      if (slices === 'movable') rebind(views[i] as never, RECYCLED, 0, scalars[i]!.codec.size);
      else views[i] = RECYCLED;
    }
    const children = instance[CHILDREN];
    for (let i = 0; i < nested.length; i++) {
      (nested[i]!.codec as unknown as InternalClass)[UNBIND](children[i]!);
    }
  }

  function bindPublic(instance: Internal, view: DataViewLike): void {
    checkSize(view);
    bind(instance, rootOf(view), baseOf(view));
  }

  class StructImpl implements Internal {
    static readonly schema = schema;
    static readonly size = size;

    [FIELDS]: DataViewLike[];
    [CHILDREN]: Internal[];
    [OWNED] = false;
    [LIVE] = false;

    constructor(view?: DataViewLike) {
      this[FIELDS] = scalars.map(({ codec }) =>
        slices === 'movable' ? makeSlice(RECYCLED, 0, codec.size) : RECYCLED,
      );
      this[CHILDREN] = nested.map(({ codec }) => {
        const child = new (codec as unknown as InternalClass)();
        child[OWNED] = true;
        return child;
      });
      if (view !== undefined) bindPublic(this, view);
    }

    static [BIND](instance: Internal, root: DataView, base: number): void {
      bind(instance, root, base);
    }

    static [UNBIND](instance: Internal): void {
      unbind(instance);
    }

    static create(view: DataViewLike): StructImpl {
      const instance = pool.pop() ?? new StructImpl();
      bindPublic(instance, view);
      return instance;
    }

    static recycle(instance: StructImpl): void {
      if (!(instance instanceof StructImpl)) {
        throw new TypeError(`${name}.recycle: expected an instance of ${name}.`);
      }
      if (instance[OWNED]) {
        throw new TypeError(`${name}.recycle: a nested field belongs to its parent. Recycle the parent.`);
      }
      if (!instance[LIVE]) {
        throw new TypeError(`${name}.recycle: instance is already recycled.`);
      }
      unbind(instance);
      pool.push(instance);
    }

    static fromDataView(view: DataViewLike): StructImpl {
      return StructImpl.create(view);
    }

    static toDataView(value: Record<string, unknown>, view: DataViewLike): void {
      const instance = StructImpl.create(view);
      try {
        instance.set(value);
      } finally {
        StructImpl.recycle(instance);
      }
    }

    set(values: Record<string, unknown>): this {
      for (const { key, codec, index, nested: isNested } of fields) {
        const value = values[key];
        if (value === undefined) continue;
        if (isNested) (this[CHILDREN][index] as unknown as StructImpl).set(value as Record<string, unknown>);
        else codec.toDataView(value, this[FIELDS][index]!);
      }
      return this;
    }

    toJSON(): Record<string, unknown> {
      const result: Record<string, unknown> = {};
      for (const { key, codec, index, nested: isNested } of fields) {
        result[key] = isNested
          ? (this[CHILDREN][index] as unknown as StructImpl).toJSON()
          : codec.fromDataView(this[FIELDS][index]!);
      }
      return result;
    }
  }

  Object.defineProperty(StructImpl, 'name', { value: name });

  // One closure per field keeps each accessor monomorphic, so V8 can inline the codec call.
  for (const { key, codec, index } of scalars) {
    Object.defineProperty(StructImpl.prototype, key, {
      get(this: Internal) {
        return codec.fromDataView(this[FIELDS][index]!);
      },
      set(this: Internal, value: unknown) {
        codec.toDataView(value, this[FIELDS][index]!);
      },
      enumerable: true,
    });
  }
  for (const { key, index } of nested) {
    Object.defineProperty(StructImpl.prototype, key, {
      get(this: Internal) {
        return this[CHILDREN][index];
      },
      enumerable: true,
    });
  }

  return StructImpl as unknown as StructClass<S>;
}
