import { BSONValue } from './bson_value';
import { BSONError } from './error';
import { type InspectFn, defaultInspect } from './parser/utils';
import { ByteUtils } from './utils/byte_utils';
import { NumberUtils } from './utils/number_utils';

// Regular expression that checks for hex value
const checkForHexRegExp = new RegExp('^[0-9a-f]{24}$');

// Unique sequence for the current process (initialized on first use)
let PROCESS_UNIQUE: Uint8Array | null = null;

const OID_SKIP_VALIDATE = Symbol();

/** @public */
export interface ObjectIdLike {
  id: string | Uint8Array;
  __id?: string;
  toHexString(): string;
}

/** @public */
export interface ObjectIdExtended {
  $oid: string;
}

/**
 * A class representation of the BSON ObjectId type.
 * @public
 * @category BSONType
 */
export class ObjectId extends BSONValue {
  get _bsontype(): 'ObjectId' {
    return 'ObjectId';
  }

  /** @internal */
  private static index = Math.floor(Math.random() * 0xffffff);

  /** @deprecated Hex string is always cached */
  static cacheHexString: boolean;

  /** Cache buffer internally, Uses much more memory but can speed up performance of some operations like getTimestamp */
  static cacheBuffer: boolean;

  /** ObjectId Bytes @internal */
  private buffer?: Uint8Array;
  /** ObjectId hexString cache @internal */
  private __id!: string;

  /**
   * Create ObjectId from a number.
   *
   * @param inputId - A number.
   * @deprecated Instead, use `static createFromTime()` to set a numeric value for the new ObjectId.
   */
  constructor(inputId: number);
  /**
   * Create ObjectId from a 24 character hex string.
   *
   * @param inputId - A 24 character hex string.
   */
  constructor(inputId: string);
  /** @internal */
  constructor(inputId: string, _internalFlag?: symbol);
  /**
   * Create ObjectId from the BSON ObjectId type.
   *
   * @param inputId - The BSON ObjectId type.
   */
  constructor(inputId: ObjectId);
  /**
   * Create ObjectId from the object type that has the toHexString method.
   *
   * @param inputId - The ObjectIdLike type.
   */
  constructor(inputId: ObjectIdLike);
  /**
   * Create ObjectId from a 12 byte binary Buffer.
   *
   * @param inputId - A 12 byte binary Buffer.
   */
  constructor(inputId: Uint8Array);
  /** To generate a new ObjectId, use ObjectId() with no argument. */
  constructor();
  /**
   * Implementation overload.
   *
   * @param inputId - All input types that are used in the constructor implementation.
   */
  constructor(inputId?: string | number | ObjectId | ObjectIdLike | Uint8Array);
  /**
   * Create a new ObjectId.
   *
   * @param inputId - An input value to create a new ObjectId from.
   */
  constructor(
    inputId?: string | number | ObjectId | ObjectIdLike | Uint8Array,
    _internalFlag?: symbol
  ) {
    let bufferCache: Uint8Array | undefined;
    super();
    // workingId is set based on type of input and whether valid id exists for the input
    let workingId;
    if (typeof inputId === 'object' && inputId && 'id' in inputId) {
      if (typeof inputId.id !== 'string' && !ArrayBuffer.isView(inputId.id)) {
        throw new BSONError('Argument passed in must have an id that is of type string or Buffer');
      }
      if ('toHexString' in inputId && typeof inputId.toHexString === 'function') {
        workingId = inputId.toHexString();
      } else {
        workingId = inputId.id;
      }
    } else {
      workingId = inputId;
    }

    // The following cases use workingId to construct an ObjectId
    if (typeof workingId === 'string') {
      if (_internalFlag === OID_SKIP_VALIDATE) {
        this.__id = workingId;
      } else {
        const validString = ObjectId.validateHexString(workingId);
        if (validString) {
          this.__id = validString;
        } else {
          throw new BSONError(
            'input must be a 24 character hex string, 12 byte Uint8Array, or an integer'
          );
        }
      }
    } else if (workingId == null || typeof workingId === 'number') {
      // The most common use case (blank id, new objectId instance)
      // Generate a new id
      bufferCache = ObjectId.generate(typeof workingId === 'number' ? workingId : undefined);
      this.__id = ByteUtils.toHex(bufferCache);
    } else if (ArrayBuffer.isView(workingId) && workingId.byteLength === 12) {
      // If intstanceof matches we can escape calling ensure buffer in Node.js environments
      bufferCache = ByteUtils.toLocalBufferType(workingId);
      this.__id = ByteUtils.toHex(bufferCache);
    } else {
      throw new BSONError('Argument passed in does not match the accepted types');
    }
    // If we are caching the buffer
    if (ObjectId.cacheBuffer) {
      this.buffer = bufferCache || ByteUtils.fromHex(this.__id);
    }
  }

  /**
   * The ObjectId bytes
   * @readonly
   */
  get id(): Uint8Array {
    return this.buffer || ByteUtils.fromHex(this.__id);
  }

  set id(value: Uint8Array) {
    this.__id = ByteUtils.toHex(value);
  }

  /** Returns the ObjectId id as a 24 lowercase character hex string representation */
  toHexString(): string {
    return this.__id;
  }

  /**
   * @internal
   * Validates the input string is a valid hex representation of an ObjectId.
   * If valid, returns the input string. Otherwise, returns false.
   * Returned string is lowercase.
   */
  private static validateHexString(input: string): false | string {
    if (input == null) return false;
    if (input.length !== 24) return false;
    if (checkForHexRegExp.test(input)) return input;
    const inputLower = input.toLowerCase();
    if (checkForHexRegExp.test(inputLower)) return inputLower;
    return false;
  }

  /**
   * Update the ObjectId index
   * @internal
   */
  private static getInc(): number {
    return (ObjectId.index = (ObjectId.index + 1) % 0xffffff);
  }

  /**
   * Generate a 12 byte id buffer used in ObjectId's
   *
   * @param time - pass in a second based timestamp.
   */
  static generate(time?: number): Uint8Array {
    if ('number' !== typeof time) {
      time = Math.floor(Date.now() / 1000);
    }

    const inc = ObjectId.getInc();
    const buffer = ByteUtils.allocateUnsafe(12);

    // 4-byte timestamp
    NumberUtils.setInt32BE(buffer, 0, time);

    // set PROCESS_UNIQUE if yet not initialized
    if (PROCESS_UNIQUE === null) {
      PROCESS_UNIQUE = ByteUtils.randomBytes(5);
    }

    // 5-byte process unique
    buffer[4] = PROCESS_UNIQUE[0];
    buffer[5] = PROCESS_UNIQUE[1];
    buffer[6] = PROCESS_UNIQUE[2];
    buffer[7] = PROCESS_UNIQUE[3];
    buffer[8] = PROCESS_UNIQUE[4];

    // 3-byte counter
    buffer[11] = inc & 0xff;
    buffer[10] = (inc >> 8) & 0xff;
    buffer[9] = (inc >> 16) & 0xff;

    return buffer;
  }

  /**
   * Converts the id into a 24 character hex string for printing, unless encoding is provided.
   * @param encoding - hex or base64
   */
  toString(encoding?: 'hex' | 'base64'): string {
    // Is the id a buffer then use the buffer toString method to return the format
    if (encoding === 'base64') return ByteUtils.toBase64(this.id);
    if (encoding === 'hex') return this.__id;
    return this.__id;
  }

  /** Converts to its JSON the 24 character hex string representation. */
  toJSON(): string {
    return this.__id;
  }

  /** @internal */
  private static is(variable: unknown): variable is ObjectId {
    return (
      variable != null &&
      typeof variable === 'object' &&
      '_bsontype' in variable &&
      variable._bsontype === 'ObjectId'
    );
  }

  /**
   * Compares the equality of this ObjectId with `otherID`.
   *
   * @param otherId - ObjectId instance to compare against.
   */
  equals(otherId: string | ObjectId | ObjectIdLike | undefined | null): boolean {
    if (otherId === undefined || otherId === null) {
      return false;
    }

    if (ObjectId.is(otherId)) {
      return this.__id === otherId.__id;
    }

    if (typeof otherId === 'string') {
      return otherId === this.__id || otherId.toLowerCase() === this.__id;
    }

    if (typeof otherId === 'object' && typeof otherId.toHexString === 'function') {
      const otherIdString = otherId.toHexString();
      const thisIdString = this.__id;
      return typeof otherIdString === 'string' && otherIdString.toLowerCase() === thisIdString;
    }

    return false;
  }

  /** Returns the generation date (accurate up to the second) that this ID was generated. */
  getTimestamp(): Date {
    const buffer = this.buffer || ByteUtils.fromHex(this.__id);
    const timestamp = new Date();
    const time = NumberUtils.getUint32BE(buffer, 0);
    timestamp.setTime(Math.floor(time) * 1000);
    return timestamp;
  }

  /** @internal */
  static createPk(): ObjectId {
    return new ObjectId();
  }

  /** @internal */
  serializeInto(uint8array: Uint8Array, index: number): 12 {
    const buffer = this.buffer || ByteUtils.fromHex(this.__id);
    uint8array[index] = buffer[0];
    uint8array[index + 1] = buffer[1];
    uint8array[index + 2] = buffer[2];
    uint8array[index + 3] = buffer[3];
    uint8array[index + 4] = buffer[4];
    uint8array[index + 5] = buffer[5];
    uint8array[index + 6] = buffer[6];
    uint8array[index + 7] = buffer[7];
    uint8array[index + 8] = buffer[8];
    uint8array[index + 9] = buffer[9];
    uint8array[index + 10] = buffer[10];
    uint8array[index + 11] = buffer[11];
    return 12;
  }

  /**
   * Creates an ObjectId from a second based number, with the rest of the ObjectId zeroed out. Used for comparisons or sorting the ObjectId.
   *
   * @param time - an integer number representing a number of seconds.
   */
  static createFromTime(time: number): ObjectId {
    const buffer = ByteUtils.allocateUnsafe(12);
    for (let i = 11; i >= 4; i--) buffer[i] = 0;
    // Encode time into first 4 bytes
    NumberUtils.setInt32BE(buffer, 0, time);
    // Return the new objectId
    return new ObjectId(buffer);
  }

  /**
   * Creates an ObjectId from a hex string representation of an ObjectId.
   *
   * @param hexString - create a ObjectId from a passed in 24 character hexstring.
   */
  static createFromHexString(hexString: string): ObjectId {
    if (hexString?.length !== 24) {
      throw new BSONError('hex string must be 24 characters');
    }

    return new ObjectId(hexString);
  }

  /** Creates an ObjectId instance from a base64 string */
  static createFromBase64(base64: string): ObjectId {
    if (base64?.length !== 16) {
      throw new BSONError('base64 string must be 16 characters');
    }

    return new ObjectId(ByteUtils.fromBase64(base64));
  }

  /**
   * Checks if a value can be used to create a valid bson ObjectId
   * @param id - any JS value
   */
  static isValid(id: string | number | ObjectId | ObjectIdLike | Uint8Array): boolean {
    if (id == null) return false;
    if (typeof id === 'string') return !!ObjectId.validateHexString(id);

    try {
      new ObjectId(id);
      return true;
    } catch {
      return false;
    }
  }

  /** @internal */
  toExtendedJSON(): ObjectIdExtended {
    return { $oid: this.__id };
  }

  /** @internal */
  static fromExtendedJSON(doc: ObjectIdExtended): ObjectId {
    return new ObjectId(doc.$oid, OID_SKIP_VALIDATE);
  }

  /**
   * Converts to a string representation of this Id.
   *
   * @returns return the 24 character hex string representation.
   */
  inspect(depth?: number, options?: unknown, inspect?: InspectFn): string {
    inspect ??= defaultInspect;
    return `new ObjectId(${inspect(this.__id, options)})`;
  }
}
