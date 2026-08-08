import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ByteBuffer } from '../src/transport/ByteBuffer.js';
import { TransportDisconnectedError, TransportTimeoutError } from '../src/transport/errors.js';

describe('ByteBuffer', () => {
  it('buffers appended chunks and reports total length', () => {
    const buf = new ByteBuffer();
    buf.append(new Uint8Array([1, 2, 3]));
    buf.append(new Uint8Array([4, 5]));
    expect(buf.length).toBe(5);
  });

  it('ignores empty chunks', () => {
    const buf = new ByteBuffer();
    buf.append(new Uint8Array([]));
    expect(buf.length).toBe(0);
  });

  it('read(n) returns up to n bytes and leaves the remainder buffered', () => {
    const buf = new ByteBuffer();
    buf.append(new Uint8Array([1, 2, 3, 4, 5]));

    const first = buf.read(2);
    expect([...first]).toEqual([1, 2]);
    expect(buf.length).toBe(3);

    const rest = buf.readAll();
    expect([...rest]).toEqual([3, 4, 5]);
    expect(buf.length).toBe(0);
  });

  it('read() with no argument drains everything buffered', () => {
    const buf = new ByteBuffer();
    buf.append(new Uint8Array([1, 2, 3]));
    expect([...buf.read()]).toEqual([1, 2, 3]);
    expect(buf.length).toBe(0);
  });

  it('read() returns an empty array when nothing is buffered', () => {
    const buf = new ByteBuffer();
    expect(buf.read().length).toBe(0);
    expect(buf.read(10).length).toBe(0);
  });

  it('reassembles data delivered as separate partial appends', () => {
    const buf = new ByteBuffer();
    buf.append(new Uint8Array([0xde]));
    buf.append(new Uint8Array([0xad]));
    buf.append(new Uint8Array([0xbe, 0xef]));
    expect([...buf.readAll()]).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it('read(n) can split a single underlying chunk across two reads', () => {
    const buf = new ByteBuffer();
    buf.append(new Uint8Array([1, 2, 3, 4, 5, 6]));

    expect([...buf.read(4)]).toEqual([1, 2, 3, 4]);
    expect([...buf.readAll()]).toEqual([5, 6]);
  });

  it('read(n) spanning a boundary between two chunks concatenates correctly', () => {
    const buf = new ByteBuffer();
    buf.append(new Uint8Array([1, 2, 3]));
    buf.append(new Uint8Array([4, 5, 6]));

    expect([...buf.read(4)]).toEqual([1, 2, 3, 4]);
    expect([...buf.readAll()]).toEqual([5, 6]);
  });

  describe('waitForData', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('resolves immediately when data is already buffered', async () => {
      const buf = new ByteBuffer();
      buf.append(new Uint8Array([1]));
      await expect(buf.waitForData(1000)).resolves.toBeUndefined();
    });

    it('resolves once data arrives before the timeout elapses', async () => {
      const buf = new ByteBuffer();
      const wait = buf.waitForData(1000);

      await vi.advanceTimersByTimeAsync(500);
      buf.append(new Uint8Array([1]));

      await expect(wait).resolves.toBeUndefined();
    });

    it('rejects with TransportTimeoutError when nothing arrives in time', async () => {
      const buf = new ByteBuffer();
      const wait = buf.waitForData(1000);
      const assertion = expect(wait).rejects.toBeInstanceOf(TransportTimeoutError);

      await vi.advanceTimersByTimeAsync(1000);

      await assertion;
    });

    it('does not resolve a timed-out waiter late if data arrives afterward', async () => {
      const buf = new ByteBuffer();
      const wait = buf.waitForData(100);
      const assertion = expect(wait).rejects.toBeInstanceOf(TransportTimeoutError);

      await vi.advanceTimersByTimeAsync(100);
      await assertion;

      buf.append(new Uint8Array([1]));
      // The next call should resolve immediately against the now-buffered
      // byte rather than reusing the expired waiter.
      await expect(buf.waitForData(100)).resolves.toBeUndefined();
    });

    it('rejects all pending waiters with TransportDisconnectedError on close()', async () => {
      const buf = new ByteBuffer();
      const waitA = buf.waitForData(1000);
      const waitB = buf.waitForData(1000);

      buf.close();

      await expect(waitA).rejects.toBeInstanceOf(TransportDisconnectedError);
      await expect(waitB).rejects.toBeInstanceOf(TransportDisconnectedError);
    });

    it('rejects immediately if the buffer is already closed', async () => {
      const buf = new ByteBuffer();
      buf.close();
      await expect(buf.waitForData(1000)).rejects.toBeInstanceOf(TransportDisconnectedError);
    });

    it('ignores appends after close()', () => {
      const buf = new ByteBuffer();
      buf.close();
      buf.append(new Uint8Array([1, 2, 3]));
      expect(buf.length).toBe(0);
    });
  });
});
