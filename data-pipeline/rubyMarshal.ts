// A small reader for Ruby's Marshal 4.8 serialization format — enough to
// decode RPG Maker XP / Pokémon Essentials `.rxdata` files (the Gen 9 Move
// Animation Project's Data/PkmnAnimations.rxdata in particular, see
// build-move-animations.ts) without needing a Ruby interpreter on the
// machine that runs the data pipeline. Only the node types those files
// actually contain are implemented; anything else throws with the type byte
// so an unexpected file fails loudly instead of decoding garbage.
//
// Format reference: ruby/marshal.c. The two things that are easy to get
// wrong are (1) the packed "long" integer encoding and (2) the object-link
// table — every object (string, float, array, hash, user object) is
// registered in order of appearance so a later '@' node can refer back to
// it; symbols live in their own table addressed by ';'. Registration order
// has to match marshal.c exactly (an array is registered BEFORE its
// elements are read, a user-defined `_dump` payload string is NOT
// registered) or every link after the first mismatch points at the wrong
// object.

export class RubySymbol {
  constructor(readonly name: string) {}
}

/** A Ruby object that isn't a plain Array/Hash/String/number: a regular
 * `o` object (ivars only), a `C`-wrapped subclass instance of a builtin
 * (`wrapped` holds the builtin's value, ivars hold the subclass's own
 * state — Essentials' PBAnimation is an Array subclass that keeps its
 * frames in `@array`), or a `u` `_dump`/`_load` object (`data` holds the
 * raw payload — RGSS Color/Tone are four little-endian doubles). Ivar names
 * are stored without the leading '@'. */
export interface RubyObject {
  className: string;
  ivars: Record<string, RubyValue>;
  wrapped?: RubyValue;
  data?: Uint8Array;
}

export type RubyValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | RubySymbol
  | RubyValue[]
  | Map<RubyValue, RubyValue>
  | RubyObject;

const MARSHAL_MAJOR = 4;
const MARSHAL_MINOR = 8;

class Reader {
  private pos = 0;
  private readonly symbols: RubySymbol[] = [];
  private readonly objects: RubyValue[] = [];

  constructor(private readonly bytes: Uint8Array) {}

  readDocument(): RubyValue {
    const major = this.byte();
    const minor = this.byte();
    if (major !== MARSHAL_MAJOR || minor > MARSHAL_MINOR) {
      throw new Error(`unsupported Marshal version ${major}.${minor} (expected ${MARSHAL_MAJOR}.${MARSHAL_MINOR})`);
    }
    const value = this.readValue();
    if (this.pos !== this.bytes.length) {
      throw new Error(`trailing bytes after Marshal document (${this.bytes.length - this.pos})`);
    }
    return value;
  }

  private byte(): number {
    if (this.pos >= this.bytes.length) throw new Error('unexpected end of Marshal data');
    return this.bytes[this.pos++];
  }

  private raw(length: number): Uint8Array {
    if (this.pos + length > this.bytes.length) throw new Error('unexpected end of Marshal data');
    const slice = this.bytes.subarray(this.pos, this.pos + length);
    this.pos += length;
    return slice;
  }

  /** marshal.c's r_long: a signed byte b; 0 = 0; 1..4 = that many
   * little-endian bytes of a positive number follow; -1..-4 = that many
   * bytes of a negative number follow, and they replace the low bytes of
   * an all-ones word (so -129 is the single byte 0x7f under a count of
   * -1); any other value is the number itself offset by ±5 so small
   * integers (-123..122) fit in the single byte. Values from 2^30 up are
   * written as bignums ('l'), never through this path. */
  private long(): number {
    const b = (this.byte() << 24) >> 24; // sign-extend
    if (b === 0) return 0;
    if (b > 0) {
      if (b >= 5) return b - 5;
      let value = 0;
      for (let i = 0; i < b; i++) value |= this.byte() << (8 * i);
      return value >>> 0;
    }
    if (b <= -5) return b + 5;
    const count = -b;
    let value = -1;
    for (let i = 0; i < count; i++) value = (value & ~(0xff << (8 * i))) | (this.byte() << (8 * i));
    return value;
  }

  private bytesWithLength(): Uint8Array {
    return this.raw(this.long());
  }

  private symbol(): RubySymbol {
    const type = this.byte();
    if (type === 0x3a /* ':' */) {
      const symbol = new RubySymbol(latin1(this.bytesWithLength()));
      this.symbols.push(symbol);
      return symbol;
    }
    if (type === 0x3b /* ';' */) {
      const index = this.long();
      const symbol = this.symbols[index];
      if (!symbol) throw new Error(`symbol link ${index} out of range`);
      return symbol;
    }
    throw new Error(`expected a symbol, got type byte 0x${type.toString(16)} at ${this.pos - 1}`);
  }

  /** Registers an object in the link table and returns it, mirroring
   * marshal.c's r_entry — see the file comment for why order matters. */
  private register<T extends RubyValue>(value: T): T {
    this.objects.push(value);
    return value;
  }

  private readValue(): RubyValue {
    const type = this.byte();
    switch (type) {
      case 0x30: // '0' nil
        return null;
      case 0x54: // 'T'
        return true;
      case 0x46: // 'F'
        return false;
      case 0x69: // 'i' fixnum
        return this.long();
      case 0x3a: // ':' symbol
      case 0x3b: // ';' symbol link
        this.pos -= 1;
        return this.symbol();
      case 0x40: {
        // '@' object link
        const index = this.long();
        if (index >= this.objects.length) throw new Error(`object link ${index} out of range`);
        return this.objects[index];
      }
      case 0x49: {
        // 'I' ivars wrapper: an object followed by its instance variables.
        // For strings that's (nearly always) just the encoding flag, which
        // we drop; for a 'C' subclass instance it's the subclass's own
        // state, which we keep.
        const inner = this.readValue();
        const count = this.long();
        const ivars: Record<string, RubyValue> = {};
        for (let i = 0; i < count; i++) {
          const name = this.symbol().name;
          const value = this.readValue();
          ivars[name.replace(/^@/, '')] = value;
        }
        if (isRubyObject(inner)) {
          Object.assign(inner.ivars, ivars);
        }
        return inner;
      }
      case 0x22: // '"' string
        return this.register(latin1(this.bytesWithLength()));
      case 0x66: {
        // 'f' float, stored as its decimal text
        const text = latin1(this.bytesWithLength());
        const value = text === 'inf' ? Infinity : text === '-inf' ? -Infinity : text === 'nan' ? NaN : Number(text);
        return this.register(value);
      }
      case 0x6c: {
        // 'l' bignum: sign byte, length in 16-bit words, little-endian magnitude
        const sign = this.byte() === 0x2d /* '-' */ ? -1n : 1n;
        const words = this.long();
        const magnitude = this.raw(words * 2);
        let value = 0n;
        for (let i = magnitude.length - 1; i >= 0; i--) value = (value << 8n) | BigInt(magnitude[i]);
        return this.register(sign * value);
      }
      case 0x5b: {
        // '[' array — registered before its elements
        const count = this.long();
        const array: RubyValue[] = this.register([]);
        for (let i = 0; i < count; i++) array.push(this.readValue());
        return array;
      }
      case 0x7b: // '{' hash
      case 0x7d: {
        // '}' hash with a default value
        const count = this.long();
        const map: Map<RubyValue, RubyValue> = this.register(new Map());
        for (let i = 0; i < count; i++) {
          const key = this.readValue();
          const value = this.readValue();
          map.set(key, value);
        }
        if (type === 0x7d) this.readValue(); // the default, not needed
        return map;
      }
      case 0x6f: {
        // 'o' plain object: class name + ivars — registered before its ivars
        const className = this.symbol().name;
        const object: RubyObject = this.register({ className, ivars: {} });
        const count = this.long();
        for (let i = 0; i < count; i++) {
          const name = this.symbol().name;
          object.ivars[name.replace(/^@/, '')] = this.readValue();
        }
        return object;
      }
      case 0x43: {
        // 'C' user class wrapping a builtin (Array/Hash/String subclass).
        // The inner builtin registers itself; the wrapper takes over that
        // same link-table slot so later '@' links resolve to the wrapper.
        const className = this.symbol().name;
        const slot = this.objects.length;
        const wrapped = this.readValue();
        const object: RubyObject = { className, ivars: {}, wrapped };
        if (this.objects[slot] === wrapped) this.objects[slot] = object;
        return object;
      }
      case 0x75: {
        // 'u' user-defined `_dump` payload — the payload bytes are NOT a
        // link-table entry (marshal.c reads them with r_bytes), the
        // resulting object is.
        const className = this.symbol().name;
        const data = this.bytesWithLength();
        return this.register({ className, ivars: {}, data: new Uint8Array(data) });
      }
      case 0x55: {
        // 'U' marshal_dump/marshal_load object: class name + one value
        const className = this.symbol().name;
        const object: RubyObject = this.register({ className, ivars: {} });
        object.wrapped = this.readValue();
        return object;
      }
      case 0x65: {
        // 'e' extended by a module: module name + the object
        this.symbol();
        return this.readValue();
      }
      default:
        throw new Error(`unsupported Marshal type byte 0x${type.toString(16)} ('${String.fromCharCode(type)}') at ${this.pos - 1}`);
    }
  }
}

function latin1(bytes: Uint8Array): string {
  // Essentials' animation names/graphic filenames are plain ASCII; decoding
  // as UTF-8 (with a latin-1 fallback for stray high bytes) keeps any
  // accented character an author typed intact.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return s;
  }
}

export function isRubyObject(value: RubyValue): value is RubyObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Map) && !(value instanceof RubySymbol);
}

export function marshalLoad(bytes: Uint8Array): RubyValue {
  return new Reader(bytes).readDocument();
}

/** RGSS `Color#_dump` / `Tone#_dump`: four little-endian IEEE doubles
 * (r, g, b, a) / (r, g, b, gray). */
export function readFourDoubles(data: Uint8Array): [number, number, number, number] {
  if (data.length < 32) throw new Error(`expected 32 bytes of doubles, got ${data.length}`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return [view.getFloat64(0, true), view.getFloat64(8, true), view.getFloat64(16, true), view.getFloat64(24, true)];
}
