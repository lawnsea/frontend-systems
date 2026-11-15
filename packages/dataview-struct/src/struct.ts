import type { Codec } from './codecs.js';

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
  /** Binds a new, unpooled instance. Prefer `create`. */
  new (view: DataView, byteOffset?: number): Struct<S>;
  readonly schema: S;
  /** Bytes one instance occupies. */
  readonly size: number;
  /** Binds a pooled instance to `size` bytes of `view` starting at `byteOffset`. */
  create(view: DataView, byteOffset?: number): Struct<S>;
  /** Returns an instance from `create` to the pool. Any later use of it throws. */
  recycle(instance: Struct<S>): void;
  /** Same as `create`. Recycle the result when done with it. */
  fromDataView(view: DataView, byteOffset: number): Struct<S>;
  /** Writes `value` field by field, so it may be a plain object or another instance. */
  toDataView(value: Init<S>, view: DataView, byteOffset: number): void;
}

const VIEW = Symbol('view');
const OFFSET = Symbol('byteOffset');
const CHILDREN = Symbol('children');
const OWNED = Symbol('owned');
const BIND = Symbol('bind');
const UNBIND = Symbol('unbind');

const RESERVED = new Set(['set', 'toJSON', 'constructor', '__proto__']);

// A recycled instance points here instead of at null, so use-after-recycle fails with a useful
// message without a check on every field access.
const RECYCLED = new Proxy({} as DataView, {
  get() {
    throw new TypeError('Struct instance used after recycle(). Call create() for a new one.');
  },
});

interface Field {
  key: string;
  byteOffset: number;
  codec: Codec<unknown>;
}

interface Internal {
  [VIEW]: DataView;
  [OFFSET]: number;
  [CHILDREN]: Internal[];
  [OWNED]: boolean;
}

interface InternalClass {
  new (): Internal;
  [BIND](instance: Internal, view: DataView, byteOffset: number): void;
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

function isStructClass(value: unknown): value is InternalClass & StructClass<Schema> {
  return typeof value === 'function' && BIND in value;
}

/**
 * Builds a class whose instances read and write `schema`'s fields in a caller-supplied DataView.
 *
 * ```ts
 * const Position = defineStruct({ x: Float32, y: Float32, z: Float32 });
 * const p = Position.create(new DataView(new ArrayBuffer(Position.size)));
 * p.x = 1;
 * Position.recycle(p);
 * ```
 */
export function defineStruct<S extends Schema>(schema: S, name = 'Struct'): StructClass<S> {
  const scalars: Field[] = [];
  const nested: Field[] = [];
  const byKey = new Map<string, Field>();
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
      codec = defineStruct(codec, `${name}.${key}`);
    }
    const { size: fieldSize } = codec as Codec<unknown>;
    if (!Number.isInteger(fieldSize) || fieldSize < 0) {
      throw new TypeError(`${name}.${key}: codec size must be a non-negative integer, got ${fieldSize}.`);
    }
    const field = { key, byteOffset: size, codec: codec as Codec<unknown> };
    (isStructClass(codec) ? nested : scalars).push(field);
    byKey.set(key, field);
    size += fieldSize;
  }

  const pool: StructImpl[] = [];

  function bind(instance: Internal, view: DataView, byteOffset: number): void {
    if (!Number.isInteger(byteOffset) || byteOffset < 0 || byteOffset + size > view.byteLength) {
      throw new RangeError(
        `${name}: needs ${size} bytes at offset ${byteOffset}, but the view is ${view.byteLength} bytes.`,
      );
    }
    instance[VIEW] = view;
    instance[OFFSET] = byteOffset;
    const children = instance[CHILDREN];
    for (let i = 0; i < nested.length; i++) {
      (nested[i]!.codec as unknown as InternalClass)[BIND](children[i]!, view, byteOffset + nested[i]!.byteOffset);
    }
  }

  function unbind(instance: Internal): void {
    instance[VIEW] = RECYCLED;
    instance[OFFSET] = 0;
    const children = instance[CHILDREN];
    for (let i = 0; i < nested.length; i++) {
      (nested[i]!.codec as unknown as InternalClass)[UNBIND](children[i]!);
    }
  }

  class StructImpl implements Internal {
    static readonly schema = schema;
    static readonly size = size;

    [VIEW]: DataView = RECYCLED;
    [OFFSET] = 0;
    [CHILDREN]: Internal[];
    [OWNED] = false;

    constructor(view?: DataView, byteOffset = 0) {
      this[CHILDREN] = nested.map(({ codec }) => {
        const child = new (codec as unknown as InternalClass)();
        child[OWNED] = true;
        return child;
      });
      if (view !== undefined) bind(this, view, byteOffset);
    }

    static [BIND](instance: Internal, view: DataView, byteOffset: number): void {
      bind(instance, view, byteOffset);
    }

    static [UNBIND](instance: Internal): void {
      unbind(instance);
    }

    static create(view: DataView, byteOffset = 0): StructImpl {
      const instance = pool.pop() ?? new StructImpl();
      bind(instance, view, byteOffset);
      return instance;
    }

    static recycle(instance: StructImpl): void {
      if (!(instance instanceof StructImpl)) {
        throw new TypeError(`${name}.recycle: expected an instance of ${name}.`);
      }
      if (instance[OWNED]) {
        throw new TypeError(`${name}.recycle: a nested field belongs to its parent. Recycle the parent.`);
      }
      if (instance[VIEW] === RECYCLED) {
        throw new TypeError(`${name}.recycle: instance is already recycled.`);
      }
      unbind(instance);
      pool.push(instance);
    }

    static fromDataView(view: DataView, byteOffset: number): StructImpl {
      return StructImpl.create(view, byteOffset);
    }

    static toDataView(value: Record<string, unknown>, view: DataView, byteOffset: number): void {
      if (!Number.isInteger(byteOffset) || byteOffset < 0 || byteOffset + size > view.byteLength) {
        throw new RangeError(
          `${name}: needs ${size} bytes at offset ${byteOffset}, but the view is ${view.byteLength} bytes.`,
        );
      }
      for (const { key, byteOffset: fieldOffset, codec } of byKey.values()) {
        codec.toDataView(value[key], view, byteOffset + fieldOffset);
      }
    }

    set(values: Record<string, unknown>): this {
      const children = this[CHILDREN];
      for (const [key, field] of byKey) {
        const value = values[key];
        if (value === undefined) continue;
        const childIndex = nested.indexOf(field);
        if (childIndex === -1) {
          field.codec.toDataView(value, this[VIEW], this[OFFSET] + field.byteOffset);
        } else {
          (children[childIndex] as unknown as StructImpl).set(value as Record<string, unknown>);
        }
      }
      return this;
    }

    toJSON(): Record<string, unknown> {
      const result: Record<string, unknown> = {};
      const children = this[CHILDREN];
      for (const [key, field] of byKey) {
        const childIndex = nested.indexOf(field);
        result[key] =
          childIndex === -1
            ? field.codec.fromDataView(this[VIEW], this[OFFSET] + field.byteOffset)
            : (children[childIndex] as unknown as StructImpl).toJSON();
      }
      return result;
    }
  }

  Object.defineProperty(StructImpl, 'name', { value: name });

  // One closure per field keeps each accessor monomorphic, so V8 can inline the codec call.
  for (const { key, byteOffset, codec } of scalars) {
    Object.defineProperty(StructImpl.prototype, key, {
      get(this: Internal) {
        return codec.fromDataView(this[VIEW], this[OFFSET] + byteOffset);
      },
      set(this: Internal, value: unknown) {
        codec.toDataView(value, this[VIEW], this[OFFSET] + byteOffset);
      },
      enumerable: true,
    });
  }
  nested.forEach(({ key }, i) => {
    Object.defineProperty(StructImpl.prototype, key, {
      get(this: Internal) {
        return this[CHILDREN][i];
      },
      enumerable: true,
    });
  });

  return StructImpl as unknown as StructClass<S>;
}
