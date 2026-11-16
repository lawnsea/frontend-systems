import type { DataViewLike } from './slice.js';

/**
 * **Codec:** a value that reads and writes one field type at the start of a DataView or
 * DataViewSlice. Built-in codecs are static classes; any object with this shape works as a schema
 * field.
 */
export interface Codec<T> {
  /** Bytes the field occupies. */
  readonly size: number;
  fromDataView(view: DataViewLike): T;
  toDataView(value: T, view: DataViewLike): void;
}

// Multi-byte codecs are little-endian, the byte order of x86, ARM, and WebAssembly.
// The `BE` variants are big-endian.

export class Int8 {
  static readonly size = 1;
  static fromDataView(view: DataViewLike): number {
    return view.getInt8(0);
  }
  static toDataView(value: number, view: DataViewLike): void {
    view.setInt8(0, value);
  }
}

export class Uint8 {
  static readonly size = 1;
  static fromDataView(view: DataViewLike): number {
    return view.getUint8(0);
  }
  static toDataView(value: number, view: DataViewLike): void {
    view.setUint8(0, value);
  }
}

/** One byte: 0 is false, anything else is true. */
export class Bool {
  static readonly size = 1;
  static fromDataView(view: DataViewLike): boolean {
    return view.getUint8(0) !== 0;
  }
  static toDataView(value: boolean, view: DataViewLike): void {
    view.setUint8(0, value ? 1 : 0);
  }
}

export class Int16 {
  static readonly size = 2;
  static fromDataView(view: DataViewLike): number {
    return view.getInt16(0, true);
  }
  static toDataView(value: number, view: DataViewLike): void {
    view.setInt16(0, value, true);
  }
}

export class Uint16 {
  static readonly size = 2;
  static fromDataView(view: DataViewLike): number {
    return view.getUint16(0, true);
  }
  static toDataView(value: number, view: DataViewLike): void {
    view.setUint16(0, value, true);
  }
}

export class Int32 {
  static readonly size = 4;
  static fromDataView(view: DataViewLike): number {
    return view.getInt32(0, true);
  }
  static toDataView(value: number, view: DataViewLike): void {
    view.setInt32(0, value, true);
  }
}

export class Uint32 {
  static readonly size = 4;
  static fromDataView(view: DataViewLike): number {
    return view.getUint32(0, true);
  }
  static toDataView(value: number, view: DataViewLike): void {
    view.setUint32(0, value, true);
  }
}

export class Float32 {
  static readonly size = 4;
  static fromDataView(view: DataViewLike): number {
    return view.getFloat32(0, true);
  }
  static toDataView(value: number, view: DataViewLike): void {
    view.setFloat32(0, value, true);
  }
}

export class Float64 {
  static readonly size = 8;
  static fromDataView(view: DataViewLike): number {
    return view.getFloat64(0, true);
  }
  static toDataView(value: number, view: DataViewLike): void {
    view.setFloat64(0, value, true);
  }
}

export class BigInt64 {
  static readonly size = 8;
  static fromDataView(view: DataViewLike): bigint {
    return view.getBigInt64(0, true);
  }
  static toDataView(value: bigint, view: DataViewLike): void {
    view.setBigInt64(0, value, true);
  }
}

export class BigUint64 {
  static readonly size = 8;
  static fromDataView(view: DataViewLike): bigint {
    return view.getBigUint64(0, true);
  }
  static toDataView(value: bigint, view: DataViewLike): void {
    view.setBigUint64(0, value, true);
  }
}

export class Int16BE {
  static readonly size = 2;
  static fromDataView(view: DataViewLike): number {
    return view.getInt16(0);
  }
  static toDataView(value: number, view: DataViewLike): void {
    view.setInt16(0, value);
  }
}

export class Uint16BE {
  static readonly size = 2;
  static fromDataView(view: DataViewLike): number {
    return view.getUint16(0);
  }
  static toDataView(value: number, view: DataViewLike): void {
    view.setUint16(0, value);
  }
}

export class Int32BE {
  static readonly size = 4;
  static fromDataView(view: DataViewLike): number {
    return view.getInt32(0);
  }
  static toDataView(value: number, view: DataViewLike): void {
    view.setInt32(0, value);
  }
}

export class Uint32BE {
  static readonly size = 4;
  static fromDataView(view: DataViewLike): number {
    return view.getUint32(0);
  }
  static toDataView(value: number, view: DataViewLike): void {
    view.setUint32(0, value);
  }
}

export class Float32BE {
  static readonly size = 4;
  static fromDataView(view: DataViewLike): number {
    return view.getFloat32(0);
  }
  static toDataView(value: number, view: DataViewLike): void {
    view.setFloat32(0, value);
  }
}

export class Float64BE {
  static readonly size = 8;
  static fromDataView(view: DataViewLike): number {
    return view.getFloat64(0);
  }
  static toDataView(value: number, view: DataViewLike): void {
    view.setFloat64(0, value);
  }
}

export class BigInt64BE {
  static readonly size = 8;
  static fromDataView(view: DataViewLike): bigint {
    return view.getBigInt64(0);
  }
  static toDataView(value: bigint, view: DataViewLike): void {
    view.setBigInt64(0, value);
  }
}

export class BigUint64BE {
  static readonly size = 8;
  static fromDataView(view: DataViewLike): bigint {
    return view.getBigUint64(0);
  }
  static toDataView(value: bigint, view: DataViewLike): void {
    view.setBigUint64(0, value);
  }
}
