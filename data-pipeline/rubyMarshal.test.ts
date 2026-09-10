import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RubySymbol, isRubyObject, marshalLoad, readFourDoubles, type RubyObject, type RubyValue } from './rubyMarshal';

// fixtures/marshal-fixture.bin was produced by Ruby 2.6's Marshal.dump of a
// structure shaped like Essentials' PkmnAnimations.rxdata (PBAnimations /
// PBAnimation Array subclasses keeping their items in @array, a
// PBAnimTiming plain object, Color/Tone _dump payloads) plus one of every
// integer encoding, floats, an empty string, a symbol hash key, and a
// repeated object reference — so a decoding mistake in any node type or in
// link-table bookkeeping shows up here rather than as subtly wrong
// animation data.
const FIXTURE = new Uint8Array(readFileSync(new URL('./fixtures/marshal-fixture.bin', import.meta.url)));

function asObject(value: RubyValue): RubyObject {
  if (!isRubyObject(value)) throw new Error(`expected a RubyObject, got ${String(value)}`);
  return value;
}

describe('marshalLoad', () => {
  const doc = marshalLoad(FIXTURE) as RubyValue[];

  it('decodes the top-level array with every scalar encoding', () => {
    expect(Array.isArray(doc)).toBe(true);
    expect(doc.length).toBe(15);
    expect(doc[2]).toBe('PRAS- Strike.png');
    expect(doc[3]).toBeInstanceOf(RubySymbol);
    expect((doc[3] as RubySymbol).name).toBe('sym');
    // Marshal writes anything from 2^30 up as a bignum (the check is on the
    // tagged fixnum representation), which this reader surfaces as a bigint.
    expect(doc.slice(4, 11)).toEqual([300, 255, 256, -129, -256, BigInt(2 ** 30), BigInt(2 ** 31 - 1)]);
    expect(doc[11]).toBe(1);
    expect(doc[12]).toBe(-0.5);
    expect(doc[13]).toBe('');
    expect(doc[14]).toEqual([1, [2, [3]]]);
  });

  it('decodes Array-subclass instances with their own ivars (PBAnimations/PBAnimation)', () => {
    const all = asObject(doc[0]);
    expect(all.className).toBe('PBAnimations');
    expect(all.ivars.selected).toBe(2);
    const anims = all.ivars.array as RubyValue[];
    expect(anims.length).toBe(4);
    expect(anims[1]).toBeNull();

    const tackle = asObject(anims[0]);
    expect(tackle.className).toBe('PBAnimation');
    expect(tackle.ivars.name).toBe('Move:TACKLE');
    expect(tackle.ivars.graphic).toBe('PRAS- Strike.png');
    expect(tackle.ivars.hue).toBe(0);
    expect(tackle.ivars.position).toBe(3);

    const frames = tackle.ivars.array as RubyValue[][];
    expect(frames.length).toBe(2);
    expect(frames[1]).toEqual([]);
    const [user, target, gap, cell] = frames[0];
    expect(user).toEqual([128, 224, 100, 0, 0, 0, 1, -1, 255, null, null, 100, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 3]);
    expect((target as RubyValue[])[7]).toBe(-2);
    expect(gap).toBeNull();
    expect(cell).toEqual([200, 150, 120, 45, 1, 1, 1, 7, 200, null, null, 80, 255, 0, 0, 128, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3]);

    const flamethrower = asObject(anims[2]);
    expect(flamethrower.ivars.name).toBe('Move:FLAMETHROWER');
    expect(flamethrower.ivars.hue).toBe(180);
    expect(flamethrower.ivars.array).toEqual([[null]]);
  });

  it('resolves object links back to the same decoded object', () => {
    const anims = asObject(doc[0]).ivars.array as RubyValue[];
    expect(anims[3]).toBe(anims[0]);
  });

  it('decodes plain objects and _dump payloads (PBAnimTiming with a Color)', () => {
    const tackle = asObject((asObject(doc[0]).ivars.array as RubyValue[])[0]);
    const timing = tackle.ivars.timing as RubyValue[];
    expect(timing.length).toBe(1);
    const entry = asObject(timing[0]);
    expect(entry.className).toBe('PBAnimTiming');
    expect(entry.ivars.frame).toBe(3);
    expect(entry.ivars.timingType).toBe(0);
    expect(entry.ivars.name).toBe('PRSFX- Tackle.wav');
    const color = asObject(entry.ivars.flashColor);
    expect(color.className).toBe('Color');
    expect(readFourDoubles(color.data!)).toEqual([255, 128, 0, 255]);
  });

  it('decodes hashes with string and symbol keys, negative fixnums, and Tone payloads', () => {
    const hash = doc[1] as Map<RubyValue, RubyValue>;
    expect(hash).toBeInstanceOf(Map);
    expect(hash.get('k')).toBe(1.5);
    expect(hash.get('neg')).toBe(-3);
    expect(hash.get('big')).toBe(123456789);
    expect(hash.get('t')).toBe(true);
    expect(hash.get('f')).toBe(false);
    expect(hash.get('same')).toBe('PRAS- Strike.png');
    const symbolKey = [...hash.keys()].find((k) => k instanceof RubySymbol) as RubySymbol;
    expect(symbolKey.name).toBe('sym');
    expect(hash.get(symbolKey)).toBe(-70000);
    const tone = asObject(hash.get('tone')!);
    expect(tone.className).toBe('Tone');
    expect(readFourDoubles(tone.data!)).toEqual([-50, 0, 50, 0]);
  });

  it('rejects a document with the wrong version header', () => {
    expect(() => marshalLoad(new Uint8Array([5, 0, 0x30]))).toThrow(/unsupported Marshal version/);
  });
});
