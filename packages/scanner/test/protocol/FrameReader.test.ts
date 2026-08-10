import { describe, expect, it } from 'vitest';
import { FrameReader } from '../../src/protocol/frame.js';
import { FrameTooLargeError } from '../../src/protocol/errors.js';
import { parseResponseFrame } from '../../src/protocol/response.js';

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('FrameReader', () => {
  it('drops partial bytes when reset for a fresh protocol session', () => {
    const reader = new FrameReader();
    expect(reader.push(bytes('stale-partial'))).toEqual([]);
    expect(reader.pendingByteCount).toBeGreaterThan(0);
    reader.reset();
    expect(reader.pendingByteCount).toBe(0);
    expect(reader.push(bytes('fresh\n'))).toEqual([bytes('fresh')]);
  });
  it('returns a complete frame with the LF excluded', () => {
    const reader = new FrameReader();
    const frames = reader.push(bytes('hello\n'));
    expect(frames).toHaveLength(1);
    expect(new TextDecoder().decode(frames[0])).toBe('hello');
    expect(reader.pendingByteCount).toBe(0);
  });

  it('returns no frames and retains bytes when there is no LF yet', () => {
    const reader = new FrameReader();
    const frames = reader.push(bytes('partial'));
    expect(frames).toEqual([]);
    expect(reader.pendingByteCount).toBe('partial'.length);
  });

  it('reassembles a frame split across two push() calls', () => {
    const reader = new FrameReader();
    expect(reader.push(bytes('hel'))).toEqual([]);
    const frames = reader.push(bytes('lo\n'));
    expect(frames).toHaveLength(1);
    expect(new TextDecoder().decode(frames[0])).toBe('hello');
  });

  it('reassembles a frame split across three push() calls', () => {
    const reader = new FrameReader();
    expect(reader.push(bytes('a'))).toEqual([]);
    expect(reader.push(bytes('b'))).toEqual([]);
    const frames = reader.push(bytes('c\n'));
    expect(new TextDecoder().decode(frames[0]!)).toBe('abc');
  });

  it('returns multiple complete frames delivered in a single push()', () => {
    const reader = new FrameReader();
    const frames = reader.push(bytes('one\ntwo\nthree\n'));
    expect(frames.map((f) => new TextDecoder().decode(f))).toEqual(['one', 'two', 'three']);
    expect(reader.pendingByteCount).toBe(0);
  });

  it('preserves a trailing partial frame after emitting complete ones', () => {
    const reader = new FrameReader();
    const frames = reader.push(bytes('one\ntwo\npartial'));
    expect(frames.map((f) => new TextDecoder().decode(f))).toEqual(['one', 'two']);
    expect(reader.pendingByteCount).toBe('partial'.length);

    const nextFrames = reader.push(bytes('-rest\n'));
    expect(new TextDecoder().decode(nextFrames[0]!)).toBe('partial-rest');
  });

  it('emits empty frames unchanged for two adjacent LFs', () => {
    const reader = new FrameReader();
    const frames = reader.push(bytes('a\n\nb\n'));
    expect(frames).toHaveLength(3);
    expect(new TextDecoder().decode(frames[0]!)).toBe('a');
    expect(frames[1]).toHaveLength(0);
    expect(new TextDecoder().decode(frames[2]!)).toBe('b');
  });

  it('does not strip, trim, or otherwise touch frame content', () => {
    const reader = new FrameReader();
    // Leading 0x80 bytes, embedded CR, and surrounding whitespace must all
    // survive verbatim — FrameReader only looks for 0x0A.
    const raw = new Uint8Array([0x80, 0x80, 0x20, 0x7b, 0x0d, 0x7d, 0x20, 0x0a]);
    const frames = reader.push(raw);
    expect(frames).toHaveLength(1);
    expect([...frames[0]!]).toEqual([0x80, 0x80, 0x20, 0x7b, 0x0d, 0x7d, 0x20]);
  });

  it('preserves the observed CR in a CRLF-terminated JSON frame and parses it successfully', () => {
    const reader = new FrameReader();
    const wireBytes = bytes('{"command":"status","serial":"2N2400A5B70F5E3C9251"}\r\n');
    const expectedRawFrame = wireBytes.slice(0, -1);

    const frames = reader.push(wireBytes);

    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(expectedRawFrame);
    expect(frames[0]![frames[0]!.length - 1]).toBe(0x0d);

    const parsed = parseResponseFrame(frames[0]!);
    expect(parsed.kind).toBe('ok');
    expect(parsed.rawBytes).toBe(frames[0]);
    expect([...parsed.rawBytes]).toEqual([...expectedRawFrame]);
    if (parsed.kind === 'ok') {
      expect(parsed.command).toBe('status');
      expect(parsed.text.endsWith('\r')).toBe(true);
    }
  });

  it('is synchronous — push() returns frames directly, not a promise', () => {
    const reader = new FrameReader();
    const result = reader.push(bytes('sync\n'));
    expect(result).not.toBeInstanceOf(Promise);
    expect(Array.isArray(result)).toBe(true);
  });

  it('ignores zero-length chunks', () => {
    const reader = new FrameReader();
    expect(reader.push(new Uint8Array(0))).toEqual([]);
    expect(reader.pendingByteCount).toBe(0);
  });

  describe('maxBufferSize', () => {
    it('throws FrameTooLargeError once unterminated bytes exceed the configured limit', () => {
      const reader = new FrameReader({ maxBufferSize: 8 });
      expect(() => reader.push(bytes('123456789'))).toThrow(FrameTooLargeError);
    });

    it('attaches the dropped raw bytes and limit to the thrown error', () => {
      const reader = new FrameReader({ maxBufferSize: 4 });
      try {
        reader.push(bytes('abcdefgh'));
        expect.unreachable('expected FrameTooLargeError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(FrameTooLargeError);
        const typed = err as FrameTooLargeError;
        expect(typed.maxBufferSize).toBe(4);
        expect(typed.byteLength).toBe(8);
        expect(new TextDecoder().decode(typed.rawBytes)).toBe('abcdefgh');
      }
    });

    it('resynchronizes after an overflow so a later well-formed frame still parses', () => {
      const reader = new FrameReader({ maxBufferSize: 4 });
      expect(() => reader.push(bytes('toolongtoolong'))).toThrow(FrameTooLargeError);
      expect(reader.pendingByteCount).toBe(0);

      const frames = reader.push(bytes('ok\n'));
      expect(frames).toHaveLength(1);
      expect(new TextDecoder().decode(frames[0]!)).toBe('ok');
    });

    it('does not throw for a single complete frame larger than maxBufferSize delivered with its LF in one push()', () => {
      // The guard bounds unterminated buffered bytes, not the size of a
      // single already-complete frame handed over in one call.
      const reader = new FrameReader({ maxBufferSize: 4 });
      const frames = reader.push(bytes('this-is-a-long-line\n'));
      expect(frames).toHaveLength(1);
      expect(new TextDecoder().decode(frames[0]!)).toBe('this-is-a-long-line');
    });

    it('uses a generous default limit when maxBufferSize is not configured', () => {
      const reader = new FrameReader();
      expect(() => reader.push(new Uint8Array(1024).fill(0x41))).not.toThrow();
      expect(reader.pendingByteCount).toBe(1024);
    });
  });
});
