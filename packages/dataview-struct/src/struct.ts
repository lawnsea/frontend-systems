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
const OWNED = Symbol('owned');
const LIVE = Symbol('live');
const ATTACHED = Symbol('attached');
const READ = Symbol('read');
const WRITE = Symbol('write');
const RELEASE = Symbol('release');
const ACQUIRE = Symbol('acquire');

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
  /** The field's struct class, or `undefined` for a scalar codec. */
  struct: InternalClass | undefined;
  /** Where an instance keeps this nested field's child. */
  slot: symbol;
}

interface Internal {
  [VIEW]: DataView;
  [OFFSET]: number;
  [OWNED]: boolean;
  [LIVE]: boolean;
  /** How many nested children this instance holds. */
  [ATTACHED]: number;
  // Nested children, one slot per nested field.
  [slot: symbol]: unknown;
}

interface InternalClass {
  [ACQUIRE](view: DataView, byteOffset: number): Internal;
  [READ](view: DataView, byteOffset: number): Record<string, unknown>;
  [WRITE](values: Record<string, unknown>, view: DataView, byteOffset: number): void;
  [RELEASE](instance: Internal): void;
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
  return typeof value === 'function' && RELEASE in value;
}

const codecIds = new WeakMap<object, number>();
let nextCodecId = 0;

function codecId(codec: object): number {
  let id = codecIds.get(codec);
  if (id === undefined) {
    id = nextCodecId++;
    codecIds.set(codec, id);
  }
  return id;
}

// Classes for nested schema objects, keyed by field names and codec identities, so equal nested
// schemas share one class and one pool. Entries live as long as the module.
const anonymous = new Map<string, StructClass<Schema>>();

/** Validates `schema` and replaces nested schema objects with (cached) struct classes. */
function resolve(schema: Schema, name: string): [string, Codec<unknown>][] {
  return Object.keys(schema).map((key) => {
    if (RESERVED.has(key)) {
      throw new TypeError(`${name}: field name "${key}" is reserved. Rename the field.`);
    }
    const value = schema[key] as unknown;
    let codec: Codec<unknown>;
    if (isCodec(value)) {
      codec = value;
    } else if (isPlainObject(value)) {
      codec = nestedClass(value, `${name}.${key}`) as unknown as Codec<unknown>;
    } else {
      throw new TypeError(
        `${name}.${key}: expected a codec (with size, fromDataView, and toDataView) or a nested schema object.`,
      );
    }
    if (!Number.isInteger(codec.size) || codec.size < 0) {
      throw new TypeError(`${name}.${key}: codec size must be a non-negative integer, got ${codec.size}.`);
    }
    return [key, codec];
  });
}

function nestedClass(schema: Schema, name: string): StructClass<Schema> {
  const fields = resolve(schema, name);
  const key = JSON.stringify(fields.map(([field, codec]) => [field, codecId(codec)]));
  let struct = anonymous.get(key);
  if (struct === undefined) {
    struct = build(schema, fields, name);
    anonymous.set(key, struct);
  }
  return struct;
}

/**
 * Builds a class whose instances read and write `schema`'s fields in a caller-supplied DataView.
 * Nested schema objects become anonymous struct classes, shared by every nested schema with the
 * same field names and codecs.
 *
 * ```ts
 * const Position = defineStruct({ x: Float32, y: Float32, z: Float32 });
 * const p = Position.create(new DataView(new ArrayBuffer(Position.size)));
 * p.x = 1;
 * Position.recycle(p);
 * ```
 */
export function defineStruct<S extends Schema>(schema: S, name = 'Struct'): StructClass<S> {
  return build(schema, resolve(schema, name), name);
}

function build<S extends Schema>(schema: S, resolved: [string, Codec<unknown>][], name: string): StructClass<S> {
  const fields: Field[] = [];
  const nested: Field[] = [];
  let size = 0;
  for (const [key, codec] of resolved) {
    const field = { key, byteOffset: size, codec, struct: isStructClass(codec) ? codec : undefined, slot: Symbol(key) };
    fields.push(field);
    if (field.struct !== undefined) nested.push(field);
    size += codec.size;
  }

  const pool: StructImpl[] = [];

  function checkRange(view: DataView, byteOffset: number): void {
    if (!Number.isInteger(byteOffset) || byteOffset < 0 || byteOffset + size > view.byteLength) {
      throw new RangeError(
        `${name}: needs ${size} bytes at offset ${byteOffset}, but the view is ${view.byteLength} bytes.`,
      );
    }
  }

  function bind(instance: Internal, view: DataView, byteOffset: number): void {
    checkRange(view, byteOffset);
    instance[VIEW] = view;
    instance[OFFSET] = byteOffset;
    instance[LIVE] = true;
  }

  // Returns the instance and any children it created to their pools.
  function release(instance: Internal): void {
    if (instance[ATTACHED] !== 0) {
      for (let i = 0; i < releasers.length; i++) releasers[i]!(instance);
      instance[ATTACHED] = 0;
    }
    instance[VIEW] = RECYCLED;
    instance[OFFSET] = 0;
    instance[LIVE] = false;
    pool.push(instance as StructImpl);
  }

  // Each nested field gets its own closures so every slot access sees one constant key, which V8
  // handles as a fast named-property access. Initializing every slot at construction gives all
  // instances of a class one shape.
  const initializers = nested.map(({ slot }) => (instance: Internal) => {
    instance[slot] = undefined;
  });
  const releasers = nested.map(({ struct, slot }) => (instance: Internal) => {
    const child = instance[slot] as Internal | undefined;
    if (child === undefined) return;
    child[OWNED] = false;
    struct![RELEASE](child);
    instance[slot] = undefined;
  });


  function read(view: DataView, byteOffset: number): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const { key, byteOffset: fieldOffset, codec, struct } of fields) {
      result[key] =
        struct === undefined
          ? codec.fromDataView(view, byteOffset + fieldOffset)
          : struct[READ](view, byteOffset + fieldOffset);
    }
    return result;
  }

  function write(values: Record<string, unknown>, view: DataView, byteOffset: number): void {
    for (const { key, byteOffset: fieldOffset, codec, struct } of fields) {
      const value = values[key];
      if (value === undefined) continue;
      if (struct === undefined) codec.toDataView(value, view, byteOffset + fieldOffset);
      else struct[WRITE](value as Record<string, unknown>, view, byteOffset + fieldOffset);
    }
  }

  class StructImpl implements Internal {
    static readonly schema = schema;
    static readonly size = size;

    [VIEW]: DataView = RECYCLED;
    [OFFSET] = 0;
    [OWNED] = false;
    [LIVE] = false;
    [ATTACHED] = 0;
    [slot: symbol]: unknown;

    constructor(view?: DataView, byteOffset = 0) {
      for (let i = 0; i < initializers.length; i++) initializers[i]!(this);
      if (view !== undefined) bind(this, view, byteOffset);
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
      if (!instance[LIVE]) {
        throw new TypeError(`${name}.recycle: instance is already recycled.`);
      }
      release(instance);
    }

    // Binds a pooled instance without a range check, for a child inside an already-checked parent.
    static [ACQUIRE](view: DataView, byteOffset: number): StructImpl {
      const instance = pool.pop() ?? new StructImpl();
      instance[VIEW] = view;
      instance[OFFSET] = byteOffset;
      instance[LIVE] = true;
      return instance;
    }

    static [RELEASE](instance: Internal): void {
      release(instance);
    }

    static [READ](view: DataView, byteOffset: number): Record<string, unknown> {
      return read(view, byteOffset);
    }

    static [WRITE](values: Record<string, unknown>, view: DataView, byteOffset: number): void {
      write(values, view, byteOffset);
    }

    static fromDataView(view: DataView, byteOffset: number): StructImpl {
      return StructImpl.create(view, byteOffset);
    }

    static toDataView(value: Record<string, unknown>, view: DataView, byteOffset: number): void {
      checkRange(view, byteOffset);
      write(value, view, byteOffset);
    }

    set(values: Record<string, unknown>): this {
      write(values, this[VIEW], this[OFFSET]);
      return this;
    }

    toJSON(): Record<string, unknown> {
      return read(this[VIEW], this[OFFSET]);
    }
  }

  Object.defineProperty(StructImpl, 'name', { value: name });

  // One closure per field keeps each accessor monomorphic, so V8 can inline the codec call.
  for (const { key, byteOffset, codec, struct } of fields) {
    if (struct !== undefined) continue;
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
  // A nested field's instance comes from its class's pool on first read and returns on recycle.
  for (const { key, slot, struct, byteOffset } of nested) {
    const attach = (instance: Internal): Internal => {
      if (!instance[LIVE]) {
        throw new TypeError('Struct instance used after recycle(). Call create() for a new one.');
      }
      const child = struct![ACQUIRE](instance[VIEW], instance[OFFSET] + byteOffset);
      child[OWNED] = true;
      instance[slot] = child;
      (instance[ATTACHED] as number)++;
      return child;
    };
    Object.defineProperty(StructImpl.prototype, key, {
      get(this: Internal) {
        const child = this[slot];
        return child !== undefined ? child : attach(this);
      },
      enumerable: true,
    });
  }

  return StructImpl as unknown as StructClass<S>;
}
