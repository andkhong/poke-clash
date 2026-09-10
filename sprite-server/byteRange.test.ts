import { describe, expect, it } from 'vitest';
import { parseByteRange } from './byteRange';

describe('parseByteRange', () => {
  const size = 1000;

  it('returns null with no header', () => {
    expect(parseByteRange(undefined, size)).toBeNull();
    expect(parseByteRange('', size)).toBeNull();
  });

  it('parses a closed range inclusively', () => {
    expect(parseByteRange('bytes=0-499', size)).toEqual({ start: 0, end: 499 });
    expect(parseByteRange('bytes=500-999', size)).toEqual({ start: 500, end: 999 });
  });

  it('streams to the end when the end is omitted (what a media element sends first)', () => {
    expect(parseByteRange('bytes=0-', size)).toEqual({ start: 0, end: 999 });
    expect(parseByteRange('bytes=600-', size)).toEqual({ start: 600, end: 999 });
  });

  it('clamps an end past the file', () => {
    expect(parseByteRange('bytes=900-5000', size)).toEqual({ start: 900, end: 999 });
  });

  it('handles a suffix range as the last N bytes, clamped to the file', () => {
    expect(parseByteRange('bytes=-100', size)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange('bytes=-5000', size)).toEqual({ start: 0, end: 999 });
    expect(parseByteRange('bytes=-0', size)).toBeNull();
  });

  it('rejects unusable ranges so the server can answer 416', () => {
    expect(parseByteRange('bytes=1000-', size)).toBeNull(); // starts past the end
    expect(parseByteRange('bytes=700-600', size)).toBeNull(); // backwards
    expect(parseByteRange('bytes=-', size)).toBeNull();
    expect(parseByteRange('bytes=0-100,200-300', size)).toBeNull(); // multi-range
    expect(parseByteRange('items=0-100', size)).toBeNull(); // not bytes
  });
});
