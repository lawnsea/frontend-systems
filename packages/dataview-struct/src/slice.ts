function checkRange(parentLength: number, byteOffset: number, byteLength: number): void {
  if (
    !Number.isInteger(byteOffset) ||
    !Number.isInteger(byteLength) ||
    byteOffset < 0 ||
    byteLength < 0 ||
    byteOffset + byteLength > parentLength
  ) {
    throw new RangeError(
      `Slice of ${byteLength} bytes at offset ${byteOffset} doesn't fit in a view of ${parentLength} bytes.`,
    );
  }
}

function outOfBounds(byteOffset: number, size: number, length: number): RangeError {
  return new RangeError(`Offset ${byteOffset} + ${size} bytes is outside a slice of ${length} bytes.`);
}

/**
 * **DataViewSlice:** a window onto `byteLength` bytes of a DataView (or another slice), starting
 * at `byteOffset`. It is to a DataView what a DataView is to an ArrayBuffer: offsets passed to its
 * methods are relative to the slice, and accesses outside it throw `RangeError`.
 *
 * ```ts
 * const view = new DataView(new ArrayBuffer(16), 8);
 * const slice = new DataViewSlice(view, 4, 2);
 * slice.setUint16(0, 420); // writes bytes 12 and 13 of the buffer
 * ```
 *
 * A slice of a slice points straight at the underlying DataView, so nesting adds no cost.
 */
export class DataViewSlice {
  #view: DataView;
  #base: number;
  #length: number;

  constructor(parent: DataView | DataViewSlice, byteOffset = 0, byteLength = parent.byteLength - byteOffset) {
    checkRange(parent.byteLength, byteOffset, byteLength);
    if (parent instanceof DataViewSlice) {
      this.#view = parent.#view;
      this.#base = parent.#base + byteOffset;
    } else {
      this.#view = parent;
      this.#base = byteOffset;
    }
    this.#length = byteLength;
  }

  get buffer(): ArrayBufferLike {
    return this.#view.buffer;
  }

  /** Offset of the slice's first byte in `buffer`. */
  get byteOffset(): number {
    return this.#view.byteOffset + this.#base;
  }

  get byteLength(): number {
    return this.#length;
  }

  getInt8(byteOffset: number): number {
    if (!(byteOffset >= 0 && byteOffset + 1 <= this.#length)) throw outOfBounds(byteOffset, 1, this.#length);
    return this.#view.getInt8(this.#base + byteOffset);
  }

  setInt8(byteOffset: number, value: number): void {
    if (!(byteOffset >= 0 && byteOffset + 1 <= this.#length)) throw outOfBounds(byteOffset, 1, this.#length);
    this.#view.setInt8(this.#base + byteOffset, value);
  }

  getUint8(byteOffset: number): number {
    if (!(byteOffset >= 0 && byteOffset + 1 <= this.#length)) throw outOfBounds(byteOffset, 1, this.#length);
    return this.#view.getUint8(this.#base + byteOffset);
  }

  setUint8(byteOffset: number, value: number): void {
    if (!(byteOffset >= 0 && byteOffset + 1 <= this.#length)) throw outOfBounds(byteOffset, 1, this.#length);
    this.#view.setUint8(this.#base + byteOffset, value);
  }

  getInt16(byteOffset: number, littleEndian?: boolean): number {
    if (!(byteOffset >= 0 && byteOffset + 2 <= this.#length)) throw outOfBounds(byteOffset, 2, this.#length);
    return this.#view.getInt16(this.#base + byteOffset, littleEndian);
  }

  setInt16(byteOffset: number, value: number, littleEndian?: boolean): void {
    if (!(byteOffset >= 0 && byteOffset + 2 <= this.#length)) throw outOfBounds(byteOffset, 2, this.#length);
    this.#view.setInt16(this.#base + byteOffset, value, littleEndian);
  }

  getUint16(byteOffset: number, littleEndian?: boolean): number {
    if (!(byteOffset >= 0 && byteOffset + 2 <= this.#length)) throw outOfBounds(byteOffset, 2, this.#length);
    return this.#view.getUint16(this.#base + byteOffset, littleEndian);
  }

  setUint16(byteOffset: number, value: number, littleEndian?: boolean): void {
    if (!(byteOffset >= 0 && byteOffset + 2 <= this.#length)) throw outOfBounds(byteOffset, 2, this.#length);
    this.#view.setUint16(this.#base + byteOffset, value, littleEndian);
  }

  getInt32(byteOffset: number, littleEndian?: boolean): number {
    if (!(byteOffset >= 0 && byteOffset + 4 <= this.#length)) throw outOfBounds(byteOffset, 4, this.#length);
    return this.#view.getInt32(this.#base + byteOffset, littleEndian);
  }

  setInt32(byteOffset: number, value: number, littleEndian?: boolean): void {
    if (!(byteOffset >= 0 && byteOffset + 4 <= this.#length)) throw outOfBounds(byteOffset, 4, this.#length);
    this.#view.setInt32(this.#base + byteOffset, value, littleEndian);
  }

  getUint32(byteOffset: number, littleEndian?: boolean): number {
    if (!(byteOffset >= 0 && byteOffset + 4 <= this.#length)) throw outOfBounds(byteOffset, 4, this.#length);
    return this.#view.getUint32(this.#base + byteOffset, littleEndian);
  }

  setUint32(byteOffset: number, value: number, littleEndian?: boolean): void {
    if (!(byteOffset >= 0 && byteOffset + 4 <= this.#length)) throw outOfBounds(byteOffset, 4, this.#length);
    this.#view.setUint32(this.#base + byteOffset, value, littleEndian);
  }

  getFloat32(byteOffset: number, littleEndian?: boolean): number {
    if (!(byteOffset >= 0 && byteOffset + 4 <= this.#length)) throw outOfBounds(byteOffset, 4, this.#length);
    return this.#view.getFloat32(this.#base + byteOffset, littleEndian);
  }

  setFloat32(byteOffset: number, value: number, littleEndian?: boolean): void {
    if (!(byteOffset >= 0 && byteOffset + 4 <= this.#length)) throw outOfBounds(byteOffset, 4, this.#length);
    this.#view.setFloat32(this.#base + byteOffset, value, littleEndian);
  }

  getFloat64(byteOffset: number, littleEndian?: boolean): number {
    if (!(byteOffset >= 0 && byteOffset + 8 <= this.#length)) throw outOfBounds(byteOffset, 8, this.#length);
    return this.#view.getFloat64(this.#base + byteOffset, littleEndian);
  }

  setFloat64(byteOffset: number, value: number, littleEndian?: boolean): void {
    if (!(byteOffset >= 0 && byteOffset + 8 <= this.#length)) throw outOfBounds(byteOffset, 8, this.#length);
    this.#view.setFloat64(this.#base + byteOffset, value, littleEndian);
  }

  getBigInt64(byteOffset: number, littleEndian?: boolean): bigint {
    if (!(byteOffset >= 0 && byteOffset + 8 <= this.#length)) throw outOfBounds(byteOffset, 8, this.#length);
    return this.#view.getBigInt64(this.#base + byteOffset, littleEndian);
  }

  setBigInt64(byteOffset: number, value: bigint, littleEndian?: boolean): void {
    if (!(byteOffset >= 0 && byteOffset + 8 <= this.#length)) throw outOfBounds(byteOffset, 8, this.#length);
    this.#view.setBigInt64(this.#base + byteOffset, value, littleEndian);
  }

  getBigUint64(byteOffset: number, littleEndian?: boolean): bigint {
    if (!(byteOffset >= 0 && byteOffset + 8 <= this.#length)) throw outOfBounds(byteOffset, 8, this.#length);
    return this.#view.getBigUint64(this.#base + byteOffset, littleEndian);
  }

  setBigUint64(byteOffset: number, value: bigint, littleEndian?: boolean): void {
    if (!(byteOffset >= 0 && byteOffset + 8 <= this.#length)) throw outOfBounds(byteOffset, 8, this.#length);
    this.#view.setBigUint64(this.#base + byteOffset, value, littleEndian);
  }
}

