import { describe, expect, it } from 'vitest';
import { parseResponseFrame, stripLeading0x80 } from '../../src/protocol/response.js';
import type { BioZoomJsonResponse } from '../../src/protocol/response.js';

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function withLeading0x80(count: number, text: string): Uint8Array {
  const prefix = new Uint8Array(count).fill(0x80);
  const body = bytes(text);
  const out = new Uint8Array(prefix.length + body.length);
  out.set(prefix, 0);
  out.set(body, prefix.length);
  return out;
}

describe('stripLeading0x80', () => {
  it('strips a single leading 0x80 byte', () => {
    const { stripped, count } = stripLeading0x80(new Uint8Array([0x80, 0x61, 0x62]));
    expect(count).toBe(1);
    expect([...stripped]).toEqual([0x61, 0x62]);
  });

  it('strips multiple leading 0x80 bytes', () => {
    const { stripped, count } = stripLeading0x80(new Uint8Array([0x80, 0x80, 0x80, 0x61]));
    expect(count).toBe(3);
    expect([...stripped]).toEqual([0x61]);
  });

  it('strips nothing when there is no leading 0x80', () => {
    const { stripped, count } = stripLeading0x80(new Uint8Array([0x61, 0x80]));
    expect(count).toBe(0);
    expect([...stripped]).toEqual([0x61, 0x80]);
  });
});

describe('parseResponseFrame', () => {
  it('parses the confirmed get_status error example verbatim', () => {
    const raw = bytes('{"command":"get_status","serial":"2N2400A5B70F5E3C9251","type":"error"}');
    const result = parseResponseFrame(raw) as BioZoomJsonResponse;

    expect(result.kind).toBe('error');
    expect(result.command).toBe('get_status');
    expect(result.serial).toBe('2N2400A5B70F5E3C9251');
    expect(result.callIndex).toBeUndefined();
    expect(result.json).toEqual({ command: 'get_status', serial: '2N2400A5B70F5E3C9251', type: 'error' });
    expect(result.rawBytes).toBe(raw);
  });

  it('classifies kind "ok" purely as "not type:error", not a validated success schema', () => {
    const result = parseResponseFrame(bytes('{"command":"status","serial":"2N2400A5B70F5E3C9251"}')) as BioZoomJsonResponse;
    expect(result.kind).toBe('ok');
  });

  it('classifies kind "ok" when type is present but not the literal "error"', () => {
    const result = parseResponseFrame(bytes('{"command":"status","type":"something-else"}')) as BioZoomJsonResponse;
    expect(result.kind).toBe('ok');
  });

  it('strips one leading 0x80 byte before decoding', () => {
    const result = parseResponseFrame(withLeading0x80(1, '{"command":"status"}')) as BioZoomJsonResponse;
    expect(result.strippedLeadingByteCount).toBe(1);
    expect(result.kind).toBe('ok');
    expect(result.command).toBe('status');
  });

  it('strips several leading 0x80 bytes before decoding', () => {
    const result = parseResponseFrame(withLeading0x80(4, '{"command":"status"}')) as BioZoomJsonResponse;
    expect(result.strippedLeadingByteCount).toBe(4);
    expect(result.kind).toBe('ok');
  });

  it('preserves unknown/extra JSON fields verbatim', () => {
    const result = parseResponseFrame(
      bytes('{"command":"status","serial":"2N2400A5B70F5E3C9251","battery":87,"nested":{"a":1}}'),
    ) as BioZoomJsonResponse;
    expect(result.json.battery).toBe(87);
    expect(result.json.nested).toEqual({ a: 1 });
  });

  it('resolves a top-level call-index field', () => {
    const result = parseResponseFrame(bytes('{"command":"status","call-index":"abc123","type":"ok"}')) as BioZoomJsonResponse;
    expect(result.callIndex).toBe('abc123');
  });

  it('resolves a call-index embedded in the command query string', () => {
    const result = parseResponseFrame(bytes('{"command":"get_status?call-index=xyz789","type":"error"}')) as BioZoomJsonResponse;
    expect(result.callIndex).toBe('xyz789');
    expect(result.command).toBe('get_status?call-index=xyz789');
  });

  it('prefers a top-level call-index over an embedded one if somehow both are present', () => {
    const result = parseResponseFrame(
      bytes('{"command":"status?call-index=embedded","call-index":"top-level"}'),
    ) as BioZoomJsonResponse;
    expect(result.callIndex).toBe('top-level');
  });

  it('produces a decode-error for malformed UTF-8, preserving raw bytes', () => {
    const raw = new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]); // invalid UTF-8 lead bytes, not 0x80
    const result = parseResponseFrame(raw);
    expect(result.kind).toBe('decode-error');
    expect(result.rawBytes).toBe(raw);
    if (result.kind === 'decode-error') {
      expect(result.error).toBeInstanceOf(Error);
    }
  });

  it('produces a decode-error for malformed UTF-8 even after leading 0x80 bytes are stripped', () => {
    const raw = withLeading0x80(2, '');
    const withInvalidTail = new Uint8Array([...raw, 0xff, 0xfe]);
    const result = parseResponseFrame(withInvalidTail);
    expect(result.kind).toBe('decode-error');
    expect(result.strippedLeadingByteCount).toBe(2);
    expect(result.rawBytes).toBe(withInvalidTail);
  });

  it('produces a parse-error for malformed JSON, preserving raw bytes and decoded text', () => {
    const raw = bytes('{"command":"status", oops');
    const result = parseResponseFrame(raw);
    expect(result.kind).toBe('parse-error');
    expect(result.rawBytes).toBe(raw);
    if (result.kind === 'parse-error') {
      expect(result.text).toBe('{"command":"status", oops');
      expect(result.error).toBeInstanceOf(Error);
    }
  });

  it('produces a parse-error for an empty line', () => {
    const raw = bytes('');
    const result = parseResponseFrame(raw);
    expect(result.kind).toBe('parse-error');
  });

  it('produces unexpected-shape for valid JSON that is not a plain object', () => {
    for (const literal of ['42', '"just a string"', 'true', 'null', '[1,2,3]']) {
      const raw = bytes(literal);
      const result = parseResponseFrame(raw);
      expect(result.kind).toBe('unexpected-shape');
      expect(result.rawBytes).toBe(raw);
    }
  });
});
