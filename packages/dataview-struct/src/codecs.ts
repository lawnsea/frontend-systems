/**
 * **Codec:** a value that reads and writes one field type at a byte offset in a DataView.
 * Built-in codecs are static classes; any object with this shape works as a schema field.
 */
export interface Codec<T> {
  /** Bytes the field occupies. */
  readonly size: number;
  fromDataView(view: DataView, byteOffset: number): T;
  toDataView(value: T, view: DataView, byteOffset: number): void;
}

// Multi-byte codecs are little-endian, the byte order of x86, ARM, and WebAssembly.
// The `BE` variants are big-endian.

export class Int8 {
  static readonly size = 1;
  static fromDataView(view: DataView, byteOffset: number): number {
    return view.getInt8(byteOffset);
  }
  static toDataView(value: number, view: DataView, byteOffset: number): void {
    view.setInt8(byteOffset, value);
  }
}

export class Uint8 {
  static readonly size = 1;
  static fromDataView(view: DataView, byteOffset: number): number {
    return view.getUint8(byteOffset);
  }
  static toDataView(value: number, view: DataView, byteOffset: number): void {
    view.setUint8(byteOffset, value);
  }
}

/** One byte: 0 is false, anything else is true. */
export class Bool {
  static readonly size = 1;
  static fromDataView(view: DataView, byteOffset: number): boolean {
    return view.getUint8(byteOffset) !== 0;
  }
  static toDataView(value: boolean, view: DataView, byteOffset: number): void {
    view.setUint8(byteOffset, value ? 1 : 0);
  }
}

export class Int16 {
  static readonly size = 2;
  static fromDataView(view: DataView, byteOffset: number): number {
    return view.getInt16(byteOffset, true);
  }
  static toDataView(value: number, view: DataView, byteOffset: number): void {
    view.setInt16(byteOffset, value, true);
  }
}

export class Uint16 {
  static readonly size = 2;
  static fromDataView(view: DataView, byteOffset: number): number {
    return view.getUint16(byteOffset, true);
  }
  static toDataView(value: number, view: DataView, byteOffset: number): void {
    view.setUint16(byteOffset, value, true);
  }
}

export class Int32 {
  static readonly size = 4;
  static fromDataView(view: DataView, byteOffset: number): number {
    return view.getInt32(byteOffset, true);
  }
  static toDataView(value: number, view: DataView, byteOffset: number): void {
    view.setInt32(byteOffset, value, true);
  }
}

export class Uint32 {
  static readonly size = 4;
  static fromDataView(view: DataView, byteOffset: number): number {
    return view.getUint32(byteOffset, true);
  }
  static toDataView(value: number, view: DataView, byteOffset: number): void {
    view.setUint32(byteOffset, value, true);
  }
}

export class Float32 {
  static readonly size = 4;
  static fromDataView(view: DataView, byteOffset: number): number {
    return view.getFloat32(byteOffset, true);
  }
  static toDataView(value: number, view: DataView, byteOffset: number): void {
    view.setFloat32(byteOffset, value, true);
  }
}

export class Float64 {
  static readonly size = 8;
  static fromDataView(view: DataView, byteOffset: number): number {
    return view.getFloat64(byteOffset, true);
  }
  static toDataView(value: number, view: DataView, byteOffset: number): void {
    view.setFloat64(byteOffset, value, true);
  }
}

export class BigInt64 {
  static readonly size = 8;
  static fromDataView(view: DataView, byteOffset: number): bigint {
    return view.getBigInt64(byteOffset, true);
  }
  static toDataView(value: bigint, view: DataView, byteOffset: number): void {
    view.setBigInt64(byteOffset, value, true);
  }
}

export class BigUint64 {
  static readonly size = 8;
  static fromDataView(view: DataView, byteOffset: number): bigint {
    return view.getBigUint64(byteOffset, true);
  }
  static toDataView(value: bigint, view: DataView, byteOffset: number): void {
    view.setBigUint64(byteOffset, value, true);
  }
}

export class Int16BE {
  static readonly size = 2;
  static fromDataView(view: DataView, byteOffset: number): number {
    return view.getInt16(byteOffset);
  }
  static toDataView(value: number, view: DataView, byteOffset: number): void {
    view.setInt16(byteOffset, value);
  }
}

export class Uint16BE {
  static readonly size = 2;
  static fromDataView(view: DataView, byteOffset: number): number {
    return view.getUint16(byteOffset);
  }
  static toDataView(value: number, view: DataView, byteOffset: number): void {
    view.setUint16(byteOffset, value);
  }
}

export class Int32BE {
  static readonly size = 4;
  static fromDataView(view: DataView, byteOffset: number): number {
    return view.getInt32(byteOffset);
  }
  static toDataView(value: number, view: DataView, byteOffset: number): void {
    view.setInt32(byteOffset, value);
  }
}

export class Uint32BE {
  static readonly size = 4;
  static fromDataView(view: DataView, byteOffset: number): number {
    return view.getUint32(byteOffset);
  }
  static toDataView(value: number, view: DataView, byteOffset: number): void {
    view.setUint32(byteOffset, value);
  }
}

export class Float32BE {
  static readonly size = 4;
  static fromDataView(view: DataView, byteOffset: number): number {
    return view.getFloat32(byteOffset);
  }
  static toDataView(value: number, view: DataView, byteOffset: number): void {
    view.setFloat32(byteOffset, value);
  }
}

export class Float64BE {
  static readonly size = 8;
  static fromDataView(view: DataView, byteOffset: number): number {
    return view.getFloat64(byteOffset);
  }
  static toDataView(value: number, view: DataView, byteOffset: number): void {
    view.setFloat64(byteOffset, value);
  }
}

export class BigInt64BE {
  static readonly size = 8;
  static fromDataView(view: DataView, byteOffset: number): bigint {
    return view.getBigInt64(byteOffset);
  }
  static toDataView(value: bigint, view: DataView, byteOffset: number): void {
    view.setBigInt64(byteOffset, value);
  }
}

export class BigUint64BE {
  static readonly size = 8;
  static fromDataView(view: DataView, byteOffset: number): bigint {
    return view.getBigUint64(byteOffset);
  }
  static toDataView(value: bigint, view: DataView, byteOffset: number): void {
    view.setBigUint64(byteOffset, value);
  }
}
