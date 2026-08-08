import { beforeEach, describe, expect, it } from 'vitest';
import { ProtocolClient } from '../../src/protocol/ProtocolClient.js';
import {
  CallIndexMismatchError,
  FrameTooLargeError,
  ProtocolDetectionError,
  ProtocolNotStartedError,
  ProtocolResponseTimeoutError,
} from '../../src/protocol/errors.js';
import type { ParsedResponse } from '../../src/protocol/response.js';
import { TransportDisconnectedError } from '../../src/transport/errors.js';
import { FakeTransport } from '../helpers/FakeTransport.js';

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Extracts the call-index the client generated for its most recent write. */
function callIndexFromWrite(transport: FakeTransport, index = 0): string {
  const line = transport.writtenText[index]!.trim();
  const query = line.split('?')[1]!;
  return new URLSearchParams(query).get('call-index')!;
}

describe('ProtocolClient', () => {
  let transport: FakeTransport;

  beforeEach(() => {
    transport = new FakeTransport();
  });

  describe('sendCommand', () => {
    it('throws ProtocolNotStartedError if called before start()', async () => {
      const client = new ProtocolClient(transport);
      await expect(client.sendCommand('get_status')).rejects.toBeInstanceOf(ProtocolNotStartedError);
    });

    it('writes a LF-terminated command line containing a generated call-index', async () => {
      const client = new ProtocolClient(transport, { pollTimeoutMs: 10, responseTimeoutMs: 200 });
      client.start();

      const pending = client.sendCommand('get_status');
      await flushMicrotasks();

      expect(transport.writtenText).toHaveLength(1);
      const line = transport.writtenText[0]!;
      expect(line.endsWith('\n')).toBe(true);
      expect(line.startsWith('get_status?')).toBe(true);
      expect(new URLSearchParams(line.trim().split('?')[1]).get('call-index')).toBeTruthy();

      await client.stop();
      // Nothing ever answered this command — stop() must settle it rather
      // than leaving it dangling.
      await expect(pending).rejects.toThrow();
    });

    it('resolves when the response carries a matching top-level call-index', async () => {
      const client = new ProtocolClient(transport, { pollTimeoutMs: 10, responseTimeoutMs: 300 });
      client.start();

      const pending = client.sendCommand('status');
      await flushMicrotasks();
      const callIndex = callIndexFromWrite(transport);

      transport.pushIncoming(encode(`{"command":"status","call-index":"${callIndex}","type":"ok"}\n`));

      const response = await pending;
      expect(response.kind).toBe('ok');
      await client.stop();
    });

    it('resolves when the response carries a matching call-index embedded in "command"', async () => {
      const client = new ProtocolClient(transport, { pollTimeoutMs: 10, responseTimeoutMs: 300 });
      client.start();

      const pending = client.sendCommand('status');
      await flushMicrotasks();
      const callIndex = callIndexFromWrite(transport);

      transport.pushIncoming(encode(`{"command":"status?call-index=${callIndex}","type":"ok"}\n`));

      const response = await pending;
      expect(response.kind).toBe('ok');
      await client.stop();
    });

    it('resolves against a response with no call-index at all (confirmed get_status behavior)', async () => {
      const client = new ProtocolClient(transport, { pollTimeoutMs: 10, responseTimeoutMs: 300 });
      client.start();

      const pending = client.sendCommand('get_status');
      await flushMicrotasks();

      transport.pushIncoming(encode('{"command":"get_status","serial":"2N2400A5B70F5E3C9251","type":"error"}\n'));

      const response = await pending;
      expect(response.kind).toBe('error');
      await client.stop();
    });

    it('rejects with CallIndexMismatchError when the response carries a different call-index', async () => {
      const client = new ProtocolClient(transport, { pollTimeoutMs: 10, responseTimeoutMs: 300 });
      client.start();

      const pending = client.sendCommand('status');
      await flushMicrotasks();

      transport.pushIncoming(encode('{"command":"status","call-index":"definitely-not-it","type":"ok"}\n'));

      await expect(pending).rejects.toBeInstanceOf(CallIndexMismatchError);
      await client.stop();
    });

    it('reassembles a response split across multiple incoming chunks', async () => {
      const client = new ProtocolClient(transport, { pollTimeoutMs: 10, responseTimeoutMs: 500 });
      client.start();

      const pending = client.sendCommand('get_status');
      await flushMicrotasks();

      const full = encode('{"command":"get_status","serial":"2N2400A5B70F5E3C9251","type":"error"}\n');
      transport.pushIncoming(full.slice(0, 20));
      await flushMicrotasks();
      transport.pushIncoming(full.slice(20));

      const response = await pending;
      expect(response.kind).toBe('error');
      await client.stop();
    });

    it('serializes concurrent sendCommand calls', async () => {
      const client = new ProtocolClient(transport, { pollTimeoutMs: 10, responseTimeoutMs: 500 });
      client.start();

      const first = client.sendCommand('a');
      const second = client.sendCommand('b');
      await flushMicrotasks();

      // Only the first command should have been written so far.
      expect(transport.writtenText).toHaveLength(1);

      const firstCallIndex = callIndexFromWrite(transport, 0);
      transport.pushIncoming(encode(`{"command":"a","call-index":"${firstCallIndex}","type":"ok"}\n`));
      await first;
      await flushMicrotasks();

      expect(transport.writtenText).toHaveLength(2);
      const secondCallIndex = callIndexFromWrite(transport, 1);
      transport.pushIncoming(encode(`{"command":"b","call-index":"${secondCallIndex}","type":"ok"}\n`));
      await second;

      await client.stop();
    });
  });

  describe('onFrame', () => {
    it('delivers every parsed frame, including ones not matched to a pending sendCommand', async () => {
      const client = new ProtocolClient(transport, { pollTimeoutMs: 10 });
      const seen: ParsedResponse[] = [];
      client.onFrame((frame) => seen.push(frame));
      client.start();

      transport.pushIncoming(encode('{"command":"a","type":"ok"}\n{"command":"b","type":"ok"}\n'));
      await flushMicrotasks();

      expect(seen).toHaveLength(2);
      expect((seen[0] as { command?: string }).command).toBe('a');
      expect((seen[1] as { command?: string }).command).toBe('b');

      await client.stop();
    });
  });

  describe('timeout and disconnect propagation', () => {
    it('rejects sendCommand with ProtocolResponseTimeoutError when nothing answers in time', async () => {
      const client = new ProtocolClient(transport, { pollTimeoutMs: 10, responseTimeoutMs: 30 });
      client.start();

      await expect(client.sendCommand('get_status')).rejects.toBeInstanceOf(ProtocolResponseTimeoutError);
      await client.stop();
    });

    it('propagates a transport disconnect to a pending sendCommand and stops the loop', async () => {
      const client = new ProtocolClient(transport, { pollTimeoutMs: 10, responseTimeoutMs: 5000 });
      client.start();

      const pending = client.sendCommand('get_status');
      await flushMicrotasks();
      await transport.disconnect();

      await expect(pending).rejects.toBeInstanceOf(TransportDisconnectedError);
      await flushMicrotasks();
      expect(client.isRunning).toBe(false);
    });

    it('rejects a still-pending sendCommand when stop() is called manually', async () => {
      const client = new ProtocolClient(transport, { pollTimeoutMs: 10, responseTimeoutMs: 5000 });
      client.start();

      const pending = client.sendCommand('get_status');
      await flushMicrotasks();
      await client.stop();

      await expect(pending).rejects.toThrow('ProtocolClient stopped before a response arrived');
    });
  });

  describe('framing errors', () => {
    it('rejects a pending sendCommand with FrameTooLargeError and keeps the loop running', async () => {
      const client = new ProtocolClient(transport, { pollTimeoutMs: 10, responseTimeoutMs: 500, maxFrameBufferSize: 8 });
      const errors: Error[] = [];
      client.onError((err) => errors.push(err));
      client.start();

      const pending = client.sendCommand('get_status');
      await flushMicrotasks();

      transport.pushIncoming(encode('this line has no newline and is definitely too long'));
      await expect(pending).rejects.toBeInstanceOf(FrameTooLargeError);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(FrameTooLargeError);
      expect(client.isRunning).toBe(true);

      // Confirm the loop recovered and can still parse a well-formed frame.
      const nextPending = client.sendCommand('status');
      await flushMicrotasks();
      const callIndex = callIndexFromWrite(transport, 1);
      transport.pushIncoming(encode(`{"command":"status","call-index":"${callIndex}","type":"ok"}\n`));
      const response = await nextPending;
      expect(response.kind).toBe('ok');

      await client.stop();
    });
  });

  describe('detectV2', () => {
    it('confirms V2 directly when get_status is not an error', async () => {
      const client = new ProtocolClient(transport, { pollTimeoutMs: 10, responseTimeoutMs: 300 });
      client.start();

      const detection = client.detectV2();
      await flushMicrotasks();
      const callIndex = callIndexFromWrite(transport, 0);
      transport.pushIncoming(encode(`{"command":"get_status","call-index":"${callIndex}","type":"ok"}\n`));

      const result = await detection;
      expect(result.version).toBe('v2');
      expect(result.commandUsed).toBe('get_status');
      expect(transport.writtenText).toHaveLength(1);

      await client.stop();
    });

    it('retries with status when get_status returns the confirmed JSON error response', async () => {
      const client = new ProtocolClient(transport, { pollTimeoutMs: 10, responseTimeoutMs: 300 });
      client.start();

      const detection = client.detectV2();
      await flushMicrotasks();
      expect(transport.writtenText[0]!.startsWith('get_status?')).toBe(true);

      transport.pushIncoming(encode('{"command":"get_status","serial":"2N2400A5B70F5E3C9251","type":"error"}\n'));
      await flushMicrotasks();

      expect(transport.writtenText).toHaveLength(2);
      expect(transport.writtenText[1]!.startsWith('status?')).toBe(true);

      const statusCallIndex = callIndexFromWrite(transport, 1);
      transport.pushIncoming(encode(`{"command":"status","call-index":"${statusCallIndex}","serial":"2N2400A5B70F5E3C9251"}\n`));

      const result = await detection;
      expect(result.version).toBe('v2');
      expect(result.commandUsed).toBe('status');
      expect(result.getStatusResponse.kind).toBe('error');
      expect(result.response.kind).toBe('ok');

      await client.stop();
    });

    it('throws ProtocolDetectionError when neither response contains a "command" field', async () => {
      const client = new ProtocolClient(transport, { pollTimeoutMs: 10, responseTimeoutMs: 300 });
      client.start();

      const detection = client.detectV2();
      await flushMicrotasks();

      // A JSON error response with no "command" field at all — no
      // confirmed real-world example of this, but the detector must not
      // silently claim V2 without the evidence it's specified to check for.
      transport.pushIncoming(encode('{"type":"error"}\n'));
      await flushMicrotasks();

      // Since this response IS a JSON error, detectV2 still retries with
      // `status` per the spec's retry rule.
      expect(transport.writtenText).toHaveLength(2);
      transport.pushIncoming(encode('{"type":"error"}\n'));

      await expect(detection).rejects.toBeInstanceOf(ProtocolDetectionError);
      await client.stop();
    });
  });
});
