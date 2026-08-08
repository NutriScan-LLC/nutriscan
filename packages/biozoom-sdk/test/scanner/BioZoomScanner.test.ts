import { beforeEach, describe, expect, it } from 'vitest';
import { BioZoomScanner } from '../../src/scanner/BioZoomScanner.js';
import { ScannerNotConnectedError } from '../../src/scanner/errors.js';
import { FakeTransport } from '../helpers/FakeTransport.js';

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Extracts the call-index BioZoomScanner's internal ProtocolClient generated for its most recent write. */
function callIndexFromWrite(transport: FakeTransport, index = 0): string {
  const line = transport.writtenText[index]!.trim();
  const query = line.split('?')[1]!;
  return new URLSearchParams(query).get('call-index')!;
}

/** A transport whose connect() fails exactly once, then behaves like FakeTransport. */
class FailFirstConnectTransport extends FakeTransport {
  #shouldFail: boolean;

  constructor(shouldFail = true) {
    super();
    this.#shouldFail = shouldFail;
  }

  override async connect(): Promise<void> {
    if (this.#shouldFail) {
      this.#shouldFail = false;
      throw new Error('simulated port open failure');
    }
    await super.connect();
  }
}

describe('BioZoomScanner', () => {
  let transport: FakeTransport;

  beforeEach(() => {
    transport = new FakeTransport();
  });

  describe('connect', () => {
    it('connects the transport and starts the protocol loop', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10 } });
      expect(scanner.isConnected).toBe(false);

      await scanner.connect();

      expect(scanner.isConnected).toBe(true);
      expect(transport.isConnected).toBe(true);

      await scanner.disconnect();
    });

    it('is idempotent — a second call while already connected is a no-op', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10 } });
      await scanner.connect();
      await scanner.connect();

      expect(scanner.isConnected).toBe(true);
      await scanner.disconnect();
    });

    it('leaves the scanner disconnected if the transport fails to connect', async () => {
      const failing = new FailFirstConnectTransport();
      const scanner = new BioZoomScanner(failing, { protocol: { pollTimeoutMs: 10 } });

      await expect(scanner.connect()).rejects.toThrow('simulated port open failure');
      expect(scanner.isConnected).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('is safe to call before connect() was ever called', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10 } });
      await expect(scanner.disconnect()).resolves.toBeUndefined();
      expect(scanner.isConnected).toBe(false);
    });

    it('stops the protocol loop, disconnects the transport, and clears identity', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10, responseTimeoutMs: 300 } });
      await scanner.connect();

      const pending = scanner.identify();
      await flushMicrotasks();
      const callIndex = callIndexFromWrite(transport);
      transport.pushIncoming(encode(`{"command":"get_status","call-index":"${callIndex}","serial":"2N2400A5B70F5E3C9251"}\n`));
      await pending;

      expect(scanner.identity).not.toBeNull();

      await scanner.disconnect();

      expect(scanner.isConnected).toBe(false);
      expect(transport.isConnected).toBe(false);
      expect(scanner.identity).toBeNull();
    });
  });

  describe('identify', () => {
    it('throws ScannerNotConnectedError when called before connect()', async () => {
      const scanner = new BioZoomScanner(transport);
      await expect(scanner.identify()).rejects.toBeInstanceOf(ScannerNotConnectedError);
    });

    it('resolves the serial from a direct (non-error) get_status response', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10, responseTimeoutMs: 300 } });
      await scanner.connect();

      const pending = scanner.identify();
      await flushMicrotasks();
      const callIndex = callIndexFromWrite(transport, 0);
      transport.pushIncoming(encode(`{"command":"get_status","call-index":"${callIndex}","serial":"2N2400A5B70F5E3C9251"}\n`));

      const identity = await pending;
      expect(identity.serial).toBe('2N2400A5B70F5E3C9251');
      expect(identity.protocolVersion).toBe('v2');
      expect(identity.commandUsed).toBe('get_status');
      expect(scanner.identity).toEqual(identity);

      await scanner.disconnect();
    });

    it('resolves the serial via the status retry when get_status returns the confirmed JSON error', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10, responseTimeoutMs: 300 } });
      await scanner.connect();

      const pending = scanner.identify();
      await flushMicrotasks();
      transport.pushIncoming(encode('{"command":"get_status","serial":"2N2400A5B70F5E3C9251","type":"error"}\n'));
      await flushMicrotasks();

      const statusCallIndex = callIndexFromWrite(transport, 1);
      transport.pushIncoming(encode(`{"command":"status","call-index":"${statusCallIndex}","serial":"2N2400A5B70F5E3C9251"}\n`));

      const identity = await pending;
      expect(identity.serial).toBe('2N2400A5B70F5E3C9251');
      expect(identity.commandUsed).toBe('status');

      await scanner.disconnect();
    });

    it('leaves identity undefined-serial rather than guessing when the response carries no serial field', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10, responseTimeoutMs: 300 } });
      await scanner.connect();

      const pending = scanner.identify();
      await flushMicrotasks();
      const callIndex = callIndexFromWrite(transport, 0);
      transport.pushIncoming(encode(`{"command":"get_status","call-index":"${callIndex}"}\n`));

      const identity = await pending;
      expect(identity.serial).toBeUndefined();

      await scanner.disconnect();
    });
  });
});
