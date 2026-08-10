import { beforeEach, describe, expect, it } from 'vitest';
import { WebSerialTransport, type WebSerialTransportOptions } from '../src/transport/WebSerialTransport.js';
import { TransportDisconnectedError, TransportNotConnectedError, TransportTimeoutError } from '../src/transport/errors.js';
import { FakeSerialPort } from './helpers/FakeSerialPort.js';

function createTransport(port: FakeSerialPort, overrides: Partial<WebSerialTransportOptions> = {}): WebSerialTransport {
  return new WebSerialTransport({
    baudRate: 2_000_000,
    requestPort: async () => port as unknown as SerialPort,
    ...overrides,
  });
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('WebSerialTransport', () => {
  let port: FakeSerialPort;

  beforeEach(() => {
    port = new FakeSerialPort();
  });

  it('starts disconnected', () => {
    const transport = createTransport(port);
    expect(transport.isConnected).toBe(false);
  });

  it('connects, opening the port with the configured baud rate', async () => {
    const transport = createTransport(port);
    await transport.connect();

    expect(transport.isConnected).toBe(true);
    expect(port.openCalls).toHaveLength(1);
    expect(port.openCalls[0]?.baudRate).toBe(2_000_000);

    await transport.disconnect();
  });

  it('connect() is a no-op when already connected', async () => {
    const transport = createTransport(port);
    await transport.connect();
    await transport.connect();

    expect(port.openCalls).toHaveLength(1);
    await transport.disconnect();
  });

  it('reopens cleanly after a non-destructive disconnect', async () => {
    const transport = createTransport(port);
    await transport.connect();
    port.pushIncoming(new Uint8Array([1]));
    await flushMicrotasks();
    expect([...await transport.read(100)]).toEqual([1]);
    await transport.disconnect();

    await transport.connect();
    port.pushIncoming(new Uint8Array([2]));
    await flushMicrotasks();
    expect([...await transport.read(100)]).toEqual([2]);
    expect(port.openCalls).toHaveLength(2);
    await transport.disconnect();
  });

  describe('writes', () => {
    it('writes raw bytes to the underlying port', async () => {
      const transport = createTransport(port);
      await transport.connect();

      await transport.writeBytes(new Uint8Array([1, 2, 3]));

      expect(port.writtenChunks).toHaveLength(1);
      expect([...port.writtenChunks[0]!]).toEqual([1, 2, 3]);

      await transport.disconnect();
    });

    it('writes UTF-8 text as its encoded bytes', async () => {
      const transport = createTransport(port);
      await transport.connect();

      await transport.writeText('hi');

      expect([...port.writtenChunks[0]!]).toEqual([...new TextEncoder().encode('hi')]);

      await transport.disconnect();
    });

    it('throws TransportNotConnectedError when writing before connect', async () => {
      const transport = createTransport(port);
      await expect(transport.writeBytes(new Uint8Array([1]))).rejects.toBeInstanceOf(TransportNotConnectedError);
    });
  });

  describe('continuous reads', () => {
    it('delivers each incoming chunk to onData listeners', async () => {
      const transport = createTransport(port);
      const received: Uint8Array[] = [];
      transport.onData((chunk) => received.push(chunk));

      await transport.connect();
      port.pushIncoming(new Uint8Array([1, 2]));
      port.pushIncoming(new Uint8Array([3]));
      await flushMicrotasks();

      expect(received.map((c) => [...c])).toEqual([
        [1, 2],
        [3],
      ]);

      await transport.disconnect();
    });

    it('unsubscribe stops delivering further chunks to that listener', async () => {
      const transport = createTransport(port);
      const received: Uint8Array[] = [];
      const unsubscribe = transport.onData((chunk) => received.push(chunk));

      await transport.connect();
      port.pushIncoming(new Uint8Array([1]));
      await flushMicrotasks();
      unsubscribe();
      port.pushIncoming(new Uint8Array([2]));
      await flushMicrotasks();

      expect(received.map((c) => [...c])).toEqual([[1]]);

      await transport.disconnect();
    });

    it('reassembles bytes delivered as partial reads via the buffer', async () => {
      const transport = createTransport(port);
      await transport.connect();

      port.pushIncoming(new Uint8Array([0xde, 0xad]));
      port.pushIncoming(new Uint8Array([0xbe, 0xef]));
      await flushMicrotasks();

      const bytes = await transport.read(1000);
      expect([...bytes]).toEqual([0xde, 0xad, 0xbe, 0xef]);

      await transport.disconnect();
    });

    it('a partial chunk followed by a later chunk both surface through read()', async () => {
      const transport = createTransport(port);
      await transport.connect();

      port.pushIncoming(new Uint8Array([1]));
      const firstRead = await transport.read(1000);
      expect([...firstRead]).toEqual([1]);

      port.pushIncoming(new Uint8Array([2, 3]));
      const secondRead = await transport.read(1000);
      expect([...secondRead]).toEqual([2, 3]);

      await transport.disconnect();
    });
  });

  describe('timeouts', () => {
    it('read() rejects with TransportTimeoutError when nothing arrives in time', async () => {
      const transport = createTransport(port, { readTimeoutMs: 20 });
      await transport.connect();

      await expect(transport.read()).rejects.toBeInstanceOf(TransportTimeoutError);

      await transport.disconnect();
    });

    it('an explicit read(timeoutMs) overrides the configured default', async () => {
      const transport = createTransport(port, { readTimeoutMs: 5000 });
      await transport.connect();

      await expect(transport.read(20)).rejects.toBeInstanceOf(TransportTimeoutError);

      await transport.disconnect();
    });

    it('throws TransportNotConnectedError from read() when never connected', async () => {
      const transport = createTransport(port);
      await expect(transport.read(20)).rejects.toBeInstanceOf(TransportNotConnectedError);
    });
  });

  describe('disconnect', () => {
    it('closes the underlying port and flips isConnected', async () => {
      const transport = createTransport(port);
      await transport.connect();
      await transport.disconnect();

      expect(port.closeCallCount).toBe(1);
      expect(transport.isConnected).toBe(false);
    });

    it('rejects a pending read() with TransportDisconnectedError', async () => {
      const transport = createTransport(port, { readTimeoutMs: 5000 });
      await transport.connect();

      const pendingRead = transport.read();
      await transport.disconnect();

      await expect(pendingRead).rejects.toBeInstanceOf(TransportDisconnectedError);
    });

    it('is idempotent when called twice', async () => {
      const transport = createTransport(port);
      await transport.connect();
      await transport.disconnect();
      await expect(transport.disconnect()).resolves.toBeUndefined();
    });

    it('is a no-op when called before connect', async () => {
      const transport = createTransport(port);
      await expect(transport.disconnect()).resolves.toBeUndefined();
    });

    it('writeBytes() after disconnect throws TransportNotConnectedError', async () => {
      const transport = createTransport(port);
      await transport.connect();
      await transport.disconnect();

      await expect(transport.writeBytes(new Uint8Array([1]))).rejects.toBeInstanceOf(TransportNotConnectedError);
    });

    it('stops delivering further incoming chunks after disconnect', async () => {
      const transport = createTransport(port);
      const received: Uint8Array[] = [];
      transport.onData((chunk) => received.push(chunk));

      await transport.connect();
      await transport.disconnect();

      expect(received).toHaveLength(0);
    });
  });

  it('logs raw bytes crossing the transport in both directions', async () => {
    const events: Array<{ direction: string; bytes: number[] }> = [];
    const transport = createTransport(port, {
      logger: {
        onRawBytes: (direction, bytes) => events.push({ direction, bytes: [...bytes] }),
      },
    });

    await transport.connect();
    await transport.writeBytes(new Uint8Array([9]));
    port.pushIncoming(new Uint8Array([8]));
    await flushMicrotasks();

    expect(events).toEqual([
      { direction: 'write', bytes: [9] },
      { direction: 'read', bytes: [8] },
    ]);

    await transport.disconnect();
  });
});
