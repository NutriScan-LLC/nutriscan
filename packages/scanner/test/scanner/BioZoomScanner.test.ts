import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BioZoomScanner } from '../../src/scanner/BioZoomScanner.js';
import { AoxMeasurementStartRejectedError, MalformedAoxMeasurementAcknowledgmentError, ScannerNotConnectedError, ScannerNotIdentifiedError } from '../../src/scanner/errors.js';
import { ProtocolResponseTimeoutError } from '../../src/protocol/errors.js';
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

function crc16(bytes: Uint8Array): number {
  let value = 0xffff;
  for (const byte of bytes) {
    value ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) value = value & 0x8000 ? ((value << 1) ^ 0x1021) & 0xffff : (value << 1) & 0xffff;
  }
  return value;
}

function validAoxBlock(logicalIndex: number): string {
  const internalIndex = logicalIndex === 0 ? 1 : logicalIndex;
  const bytes = new Uint8Array(33);
  bytes[1] = 31;
  bytes[2] = internalIndex & 0xff;
  bytes[3] = internalIndex >> 8;
  for (let index = 4; index < 31; index++) bytes[index] = (logicalIndex + index) & 0xff;
  const checksum = crc16(bytes.subarray(2, 31));
  bytes[31] = checksum >> 8;
  bytes[32] = checksum & 0xff;
  return btoa(String.fromCharCode(...bytes));
}

class LiveAoxTransport extends FakeTransport {
  override async writeText(text: string): Promise<void> {
    await super.writeText(text);
    const line = text.trim();
    const [command, queryText] = line.split('?');
    const query = new URLSearchParams(queryText);
    const callIndex = query.get('call-index');
    if (command === 'status') {
      this.pushIncoming(encode(JSON.stringify({ command: line, 'call-index': callIndex, serial: 'scanner', busy: 0 }) + '\r\n'));
    } else if (command === 'delete') {
      this.pushIncoming(encode(JSON.stringify({ command: line, 'call-index': callIndex, status: 'ok' }) + '\r\n'));
    } else if (command === 'measure') {
      this.pushIncoming(encode(JSON.stringify({ command: line, 'call-index': callIndex, serial: 'scanner', type: 'aox', measurement_nr: 22 }) + '\r\n'));
    } else if (command === 'read-flash') {
      const start = Number(query.get('block'));
      const range = Number(query.get('range'));
      const data = Array.from({ length: range }, (_, offset) => validAoxBlock(start + offset));
      this.pushIncoming(encode(JSON.stringify({ command: line, 'call-index': callIndex, serial: 'scanner', data }) + '\r\n'));
    } else if (command === 'get_status') {
      this.pushIncoming(encode(JSON.stringify({ command: line, 'call-index': callIndex, serial: 'scanner' }) + '\r\n'));
    }
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

  describe('readStatusSnapshot', () => {
    it('requires identification and then sends exactly one strictly correlated status command', async () => {
      const live = new LiveAoxTransport();
      const scanner = new BioZoomScanner(live, { protocol: { pollTimeoutMs: 5, responseTimeoutMs: 300 } });
      await scanner.connect();
      await expect(scanner.readStatusSnapshot()).rejects.toBeInstanceOf(ScannerNotIdentifiedError);
      await scanner.identify();
      const status = await scanner.readStatusSnapshot();
      expect(status).toMatchObject({ kind: 'ok', json: { busy: 0 } });
      expect(live.writtenText.map((text) => text.split('?')[0])).toEqual(['get_status', 'status']);
      expect(new URLSearchParams(live.writtenText[1]!.trim().split('?')[1]).get('call-index')).toBeTruthy();
      await scanner.disconnect();
    });
  });

  describe('deleteMeasurementStorageOnceDiagnostic', () => {
    it('requires identification and sends exactly one bare, strictly correlated delete', async () => {
      const live = new LiveAoxTransport();
      const scanner = new BioZoomScanner(live, { protocol: { pollTimeoutMs: 5, responseTimeoutMs: 300 } });
      await scanner.connect();
      await expect(scanner.deleteMeasurementStorageOnceDiagnostic()).rejects.toBeInstanceOf(ScannerNotIdentifiedError);
      await scanner.identify();

      const acknowledgment = await scanner.deleteMeasurementStorageOnceDiagnostic();
      expect(acknowledgment).toMatchObject({ kind: 'ok' });
      expect(live.writtenText.map((text) => text.trim().split('?')[0])).toEqual(['get_status', 'delete']);
      const deleteQuery = new URLSearchParams(live.writtenText[1]!.trim().split('?')[1]);
      expect([...deleteQuery.keys()]).toEqual(['call-index']);
      expect(deleteQuery.get('call-index')).toBeTruthy();
      await scanner.disconnect();
    });

    it('does not accept an unrelated or call-index-less acknowledgment and never retries', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 5, responseTimeoutMs: 25 } });
      await scanner.connect();
      const identify = scanner.identify();
      await flushMicrotasks();
      transport.pushIncoming(encode(`{"command":"get_status","call-index":"${callIndexFromWrite(transport)}","serial":"scanner"}\n`));
      await identify;

      const pending = scanner.deleteMeasurementStorageOnceDiagnostic();
      await flushMicrotasks();
      transport.pushIncoming(encode('{"command":"delete","status":"ok"}\n'));
      await flushMicrotasks();
      expect(transport.writtenText).toHaveLength(2);
      const deleteCallIndex = callIndexFromWrite(transport, 1);
      transport.pushIncoming(encode(`{"command":"delete?call-index=${deleteCallIndex}","call-index":"${deleteCallIndex}","status":"ok"}\n`));
      await expect(pending).resolves.toMatchObject({ kind: 'ok' });
      expect(transport.writtenText.map((text) => text.trim().split('?')[0])).toEqual(['get_status', 'delete']);
      await scanner.disconnect();
    });
  });

  describe('startAoxMeasurementExperiment', () => {
    it('throws ScannerNotConnectedError without writing when called before connect()', async () => {
      const scanner = new BioZoomScanner(transport);

      await expect(scanner.startAoxMeasurementExperiment()).rejects.toBeInstanceOf(ScannerNotConnectedError);
      expect(transport.writtenText).toEqual([]);
    });

    it('sends exactly one measure command with type=aox and returns the ParsedResponse unchanged', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10, responseTimeoutMs: 300 } });
      await scanner.connect();

      const pending = scanner.startAoxMeasurementExperiment();
      await flushMicrotasks();

      expect(transport.writtenText).toHaveLength(1);
      const writtenLine = transport.writtenText[0]!;
      expect(writtenLine.endsWith('\n')).toBe(true);
      const [command, queryText] = writtenLine.trimEnd().split('?');
      const query = new URLSearchParams(queryText);
      expect(command).toBe('measure');
      expect(query.get('type')).toBe('aox');
      expect(query.get('call-index')).toBeTruthy();
      expect([...query.keys()].sort()).toEqual(['call-index', 'type']);

      const responseWireBytes = encode('{"command":"measure","measurement":15,"type":"aox"}\r\n');
      transport.pushIncoming(responseWireBytes);
      const response = await pending;

      expect(response.kind).toBe('ok');
      expect(response.rawBytes).toEqual(responseWireBytes.slice(0, -1));
      if (response.kind === 'ok') {
        expect(response.json).toEqual({ command: 'measure', measurement: 15, type: 'aox' });
        expect(response.text.endsWith('\r')).toBe(true);
      }
      expect(transport.writtenText).toHaveLength(1);

      await scanner.disconnect();
    });

    it('preserves a protocol error response rather than interpreting or replacing it', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10, responseTimeoutMs: 300 } });
      await scanner.connect();

      const pending = scanner.startAoxMeasurementExperiment();
      await flushMicrotasks();
      const rawFrame = encode('{"command":"measure","type":"error","detail":"unverified"}');
      transport.pushIncoming(encode('{"command":"measure","type":"error","detail":"unverified"}\n'));

      const response = await pending;
      expect(response.kind).toBe('error');
      expect(response.rawBytes).toEqual(rawFrame);
      if (response.kind === 'error') {
        expect(response.json).toEqual({ command: 'measure', type: 'error', detail: 'unverified' });
      }

      await scanner.disconnect();
    });

    it('propagates ProtocolClient response timeouts unchanged', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 5, responseTimeoutMs: 20 } });
      await scanner.connect();

      await expect(scanner.startAoxMeasurementExperiment()).rejects.toBeInstanceOf(ProtocolResponseTimeoutError);
      expect(transport.writtenText).toHaveLength(1);

      await scanner.disconnect();
    });
  });

  describe('captureStatusExperimentM2', () => {
    it('throws ScannerNotConnectedError without writing when called before connect()', async () => {
      const scanner = new BioZoomScanner(transport);

      await expect(scanner.captureStatusExperimentM2()).rejects.toBeInstanceOf(ScannerNotConnectedError);
      expect(transport.writtenText).toEqual([]);
    });

    it('sends exactly one status command and preserves the complete ParsedResponse', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10, responseTimeoutMs: 300 } });
      await scanner.connect();

      const pending = scanner.captureStatusExperimentM2();
      await flushMicrotasks();

      expect(transport.writtenText).toHaveLength(1);
      const writtenLine = transport.writtenText[0]!;
      expect(writtenLine.endsWith('\n')).toBe(true);
      const [command, queryText] = writtenLine.trimEnd().split('?');
      const query = new URLSearchParams(queryText);
      expect(command).toBe('status');
      expect(query.get('call-index')).toBeTruthy();
      expect([...query.keys()]).toEqual(['call-index']);

      const responseWireBytes = encode('{"command":"status","busy":1,"unverified_field":"preserve-me"}\r\n');
      transport.pushIncoming(responseWireBytes);
      const response = await pending;

      expect(response.kind).toBe('ok');
      expect(response.rawBytes).toEqual(responseWireBytes.slice(0, -1));
      if (response.kind === 'ok') {
        expect(response.json).toEqual({ command: 'status', busy: 1, unverified_field: 'preserve-me' });
        expect(response.text.endsWith('\r')).toBe(true);
      }
      expect(transport.writtenText).toHaveLength(1);

      await scanner.disconnect();
    });

    it('propagates ProtocolClient response timeouts unchanged', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 5, responseTimeoutMs: 20 } });
      await scanner.connect();

      await expect(scanner.captureStatusExperimentM2()).rejects.toBeInstanceOf(ProtocolResponseTimeoutError);
      expect(transport.writtenText).toHaveLength(1);

      await scanner.disconnect();
    });
  });

  describe('captureStatusExperimentM3', () => {
    it('throws ScannerNotConnectedError without writing when called before connect()', async () => {
      const scanner = new BioZoomScanner(transport);

      await expect(scanner.captureStatusExperimentM3()).rejects.toBeInstanceOf(ScannerNotConnectedError);
      expect(transport.writtenText).toEqual([]);
    });

    it('sends exactly one status command and returns its ParsedResponse unchanged', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10, responseTimeoutMs: 300 } });
      await scanner.connect();

      const pending = scanner.captureStatusExperimentM3();
      await flushMicrotasks();

      expect(transport.writtenText).toHaveLength(1);
      const writtenLine = transport.writtenText[0]!;
      expect(writtenLine.endsWith('\n')).toBe(true);
      const [command, queryText] = writtenLine.trimEnd().split('?');
      const query = new URLSearchParams(queryText);
      expect(command).toBe('status');
      expect(query.get('call-index')).toBeTruthy();
      expect([...query.keys()]).toEqual(['call-index']);

      const responseWireBytes = encode('{"command":"status","busy":0,"last_measurement_nr":21}\r\n');
      transport.pushIncoming(responseWireBytes);
      const response = await pending;

      expect(response.kind).toBe('ok');
      expect(response.rawBytes).toEqual(responseWireBytes.slice(0, -1));
      if (response.kind === 'ok') {
        expect(response.json).toEqual({ command: 'status', busy: 0, last_measurement_nr: 21 });
        expect(response.text.endsWith('\r')).toBe(true);
      }
      expect(transport.writtenText).toHaveLength(1);

      await scanner.disconnect();
    });

    it('propagates ProtocolClient response timeouts unchanged', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 5, responseTimeoutMs: 20 } });
      await scanner.connect();

      await expect(scanner.captureStatusExperimentM3()).rejects.toBeInstanceOf(ProtocolResponseTimeoutError);
      expect(transport.writtenText).toHaveLength(1);

      await scanner.disconnect();
    });
  });

  describe('readFirstFlashBlockExperimentM4', () => {
    it('throws ScannerNotConnectedError without writing when called before connect()', async () => {
      const scanner = new BioZoomScanner(transport);

      await expect(scanner.readFirstFlashBlockExperimentM4(21)).rejects.toBeInstanceOf(ScannerNotConnectedError);
      expect(transport.writtenText).toEqual([]);
    });

    it('rejects invalid measurement numbers without writing', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10 } });
      await scanner.connect();

      for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        await expect(scanner.readFirstFlashBlockExperimentM4(invalid)).rejects.toBeInstanceOf(RangeError);
      }
      expect(transport.writtenText).toEqual([]);

      await scanner.disconnect();
    });

    it('sends exactly one read-flash request for block=0 and range=1 and preserves the response', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10, responseTimeoutMs: 300 } });
      await scanner.connect();

      const pending = scanner.readFirstFlashBlockExperimentM4(21);
      await flushMicrotasks();

      expect(transport.writtenText).toHaveLength(1);
      const writtenLine = transport.writtenText[0]!;
      expect(writtenLine.endsWith('\n')).toBe(true);
      const [command, queryText] = writtenLine.trimEnd().split('?');
      const query = new URLSearchParams(queryText);
      expect(command).toBe('read-flash');
      expect(query.get('nr')).toBe('21');
      expect(query.get('block')).toBe('0');
      expect(query.get('range')).toBe('1');
      expect(query.get('call-index')).toBeTruthy();
      expect([...query.keys()].sort()).toEqual(['block', 'call-index', 'nr', 'range']);

      const responseWireBytes = encode('{"command":"read-flash","unverified_payload":["AA=="]}\r\n');
      transport.pushIncoming(responseWireBytes);
      const response = await pending;

      expect(response.kind).toBe('ok');
      expect(response.rawBytes).toEqual(responseWireBytes.slice(0, -1));
      if (response.kind === 'ok') {
        expect(response.json).toEqual({ command: 'read-flash', unverified_payload: ['AA=='] });
        expect(response.text.endsWith('\r')).toBe(true);
      }
      expect(transport.writtenText).toHaveLength(1);

      await scanner.disconnect();
    });

    it('propagates ProtocolClient response timeouts unchanged', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 5, responseTimeoutMs: 20 } });
      await scanner.connect();

      await expect(scanner.readFirstFlashBlockExperimentM4(21)).rejects.toBeInstanceOf(ProtocolResponseTimeoutError);
      expect(transport.writtenText).toHaveLength(1);

      await scanner.disconnect();
    });
  });

  describe('readSecondFlashBlockExperimentM5', () => {
    it('throws ScannerNotConnectedError without writing when called before connect()', async () => {
      const scanner = new BioZoomScanner(transport);

      await expect(scanner.readSecondFlashBlockExperimentM5(21)).rejects.toBeInstanceOf(ScannerNotConnectedError);
      expect(transport.writtenText).toEqual([]);
    });

    it('rejects invalid measurement numbers without writing', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10 } });
      await scanner.connect();

      for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        await expect(scanner.readSecondFlashBlockExperimentM5(invalid)).rejects.toBeInstanceOf(RangeError);
      }
      expect(transport.writtenText).toEqual([]);

      await scanner.disconnect();
    });

    it('sends exactly one read-flash request for block=1 and range=1 and preserves the response', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10, responseTimeoutMs: 300 } });
      await scanner.connect();

      const pending = scanner.readSecondFlashBlockExperimentM5(21);
      await flushMicrotasks();

      expect(transport.writtenText).toHaveLength(1);
      const writtenLine = transport.writtenText[0]!;
      expect(writtenLine.endsWith('\n')).toBe(true);
      const [command, queryText] = writtenLine.trimEnd().split('?');
      const query = new URLSearchParams(queryText);
      expect(command).toBe('read-flash');
      expect(query.get('nr')).toBe('21');
      expect(query.get('block')).toBe('1');
      expect(query.get('range')).toBe('1');
      expect(query.get('call-index')).toBeTruthy();
      expect([...query.keys()].sort()).toEqual(['block', 'call-index', 'nr', 'range']);

      const responseWireBytes = encode('{"command":"read-flash","data_blocks_index":1,"data":["AQ=="]}\r\n');
      transport.pushIncoming(responseWireBytes);
      const response = await pending;

      expect(response.kind).toBe('ok');
      expect(response.rawBytes).toEqual(responseWireBytes.slice(0, -1));
      if (response.kind === 'ok') {
        expect(response.json).toEqual({ command: 'read-flash', data_blocks_index: 1, data: ['AQ=='] });
        expect(response.text.endsWith('\r')).toBe(true);
      }
      expect(transport.writtenText).toHaveLength(1);

      await scanner.disconnect();
    });

    it('propagates ProtocolClient response timeouts unchanged', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 5, responseTimeoutMs: 20 } });
      await scanner.connect();

      await expect(scanner.readSecondFlashBlockExperimentM5(21)).rejects.toBeInstanceOf(ProtocolResponseTimeoutError);
      expect(transport.writtenText).toHaveLength(1);

      await scanner.disconnect();
    });
  });

  describe('readThirdFlashBlockExperimentM6', () => {
    it('throws ScannerNotConnectedError without writing when called before connect()', async () => {
      const scanner = new BioZoomScanner(transport);

      await expect(scanner.readThirdFlashBlockExperimentM6(21)).rejects.toBeInstanceOf(ScannerNotConnectedError);
      expect(transport.writtenText).toEqual([]);
    });

    it('rejects invalid measurement numbers without writing', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10 } });
      await scanner.connect();

      for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        await expect(scanner.readThirdFlashBlockExperimentM6(invalid)).rejects.toBeInstanceOf(RangeError);
      }
      expect(transport.writtenText).toEqual([]);

      await scanner.disconnect();
    });

    it('sends exactly one read-flash request for block=2 and range=1 and preserves the response', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10, responseTimeoutMs: 300 } });
      await scanner.connect();

      const pending = scanner.readThirdFlashBlockExperimentM6(21);
      await flushMicrotasks();

      expect(transport.writtenText).toHaveLength(1);
      const writtenLine = transport.writtenText[0]!;
      expect(writtenLine.endsWith('\n')).toBe(true);
      const [command, queryText] = writtenLine.trimEnd().split('?');
      const query = new URLSearchParams(queryText);
      expect(command).toBe('read-flash');
      expect(query.get('nr')).toBe('21');
      expect(query.get('block')).toBe('2');
      expect(query.get('range')).toBe('1');
      expect(query.get('call-index')).toBeTruthy();
      expect([...query.keys()].sort()).toEqual(['block', 'call-index', 'nr', 'range']);

      const responseWireBytes = encode('{"command":"read-flash","data_blocks_index":2,"data":["Ag=="]}\r\n');
      transport.pushIncoming(responseWireBytes);
      const response = await pending;

      expect(response.kind).toBe('ok');
      expect(response.rawBytes).toEqual(responseWireBytes.slice(0, -1));
      if (response.kind === 'ok') {
        expect(response.json).toEqual({ command: 'read-flash', data_blocks_index: 2, data: ['Ag=='] });
        expect(response.text.endsWith('\r')).toBe(true);
      }
      expect(transport.writtenText).toHaveLength(1);

      await scanner.disconnect();
    });

    it('propagates ProtocolClient response timeouts unchanged', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 5, responseTimeoutMs: 20 } });
      await scanner.connect();

      await expect(scanner.readThirdFlashBlockExperimentM6(21)).rejects.toBeInstanceOf(ProtocolResponseTimeoutError);
      expect(transport.writtenText).toHaveLength(1);

      await scanner.disconnect();
    });
  });

  describe('readFirstThreeFlashBlocksExperimentM7', () => {
    it('throws ScannerNotConnectedError without writing when called before connect()', async () => {
      const scanner = new BioZoomScanner(transport);

      await expect(scanner.readFirstThreeFlashBlocksExperimentM7(21)).rejects.toBeInstanceOf(ScannerNotConnectedError);
      expect(transport.writtenText).toEqual([]);
    });

    it('rejects invalid measurement numbers without writing', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10 } });
      await scanner.connect();

      for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        await expect(scanner.readFirstThreeFlashBlocksExperimentM7(invalid)).rejects.toBeInstanceOf(RangeError);
      }
      expect(transport.writtenText).toEqual([]);

      await scanner.disconnect();
    });

    it('sends exactly one read-flash request for block=0 and range=3 and preserves the response', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10, responseTimeoutMs: 300 } });
      await scanner.connect();

      const pending = scanner.readFirstThreeFlashBlocksExperimentM7(21);
      await flushMicrotasks();

      expect(transport.writtenText).toHaveLength(1);
      const writtenLine = transport.writtenText[0]!;
      expect(writtenLine.endsWith('\n')).toBe(true);
      const [command, queryText] = writtenLine.trimEnd().split('?');
      const query = new URLSearchParams(queryText);
      expect(command).toBe('read-flash');
      expect(query.get('nr')).toBe('21');
      expect(query.get('block')).toBe('0');
      expect(query.get('range')).toBe('3');
      expect(query.get('call-index')).toBeTruthy();
      expect([...query.keys()].sort()).toEqual(['block', 'call-index', 'nr', 'range']);

      const responseWireBytes = encode('{"command":"read-flash","data_blocks_index":0,"data":["AA==","AQ==","Ag=="]}\r\n');
      transport.pushIncoming(responseWireBytes);
      const response = await pending;

      expect(response.kind).toBe('ok');
      expect(response.rawBytes).toEqual(responseWireBytes.slice(0, -1));
      if (response.kind === 'ok') {
        expect(response.json).toEqual({
          command: 'read-flash',
          data_blocks_index: 0,
          data: ['AA==', 'AQ==', 'Ag=='],
        });
      }
      expect(transport.writtenText).toHaveLength(1);

      await scanner.disconnect();
    });

    it('propagates ProtocolClient response timeouts unchanged', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 5, responseTimeoutMs: 20 } });
      await scanner.connect();

      await expect(scanner.readFirstThreeFlashBlocksExperimentM7(21)).rejects.toBeInstanceOf(ProtocolResponseTimeoutError);
      expect(transport.writtenText).toHaveLength(1);

      await scanner.disconnect();
    });
  });

  describe('readBoundedFlashRangeExperimentM8', () => {
    it('throws ScannerNotConnectedError without writing when called before connect()', async () => {
      const scanner = new BioZoomScanner(transport);

      await expect(scanner.readBoundedFlashRangeExperimentM8(21)).rejects.toBeInstanceOf(ScannerNotConnectedError);
      expect(transport.writtenText).toEqual([]);
    });

    it('rejects invalid measurement numbers without writing', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10 } });
      await scanner.connect();

      for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        await expect(scanner.readBoundedFlashRangeExperimentM8(invalid)).rejects.toBeInstanceOf(RangeError);
      }
      expect(transport.writtenText).toEqual([]);

      await scanner.disconnect();
    });

    it('sends exactly one read-flash request for block=0 and range=150 and preserves the response', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10, responseTimeoutMs: 300 } });
      await scanner.connect();

      const pending = scanner.readBoundedFlashRangeExperimentM8(21);
      await flushMicrotasks();

      expect(transport.writtenText).toHaveLength(1);
      const writtenLine = transport.writtenText[0]!;
      expect(writtenLine.endsWith('\n')).toBe(true);
      const [command, queryText] = writtenLine.trimEnd().split('?');
      const query = new URLSearchParams(queryText);
      expect(command).toBe('read-flash');
      expect(query.get('nr')).toBe('21');
      expect(query.get('block')).toBe('0');
      expect(query.get('range')).toBe('150');
      expect(query.get('call-index')).toBeTruthy();
      expect([...query.keys()].sort()).toEqual(['block', 'call-index', 'nr', 'range']);

      const responseWireBytes = encode('{"command":"read-flash","data_blocks_requested":150,"data":["AA=="]}\r\n');
      transport.pushIncoming(responseWireBytes);
      const response = await pending;

      expect(response.kind).toBe('ok');
      expect(response.rawBytes).toEqual(responseWireBytes.slice(0, -1));
      if (response.kind === 'ok') {
        expect(response.json).toEqual({ command: 'read-flash', data_blocks_requested: 150, data: ['AA=='] });
      }
      expect(transport.writtenText).toHaveLength(1);

      await scanner.disconnect();
    });

    it('propagates ProtocolClient response timeouts unchanged', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 5, responseTimeoutMs: 20 } });
      await scanner.connect();

      await expect(scanner.readBoundedFlashRangeExperimentM8(21)).rejects.toBeInstanceOf(ProtocolResponseTimeoutError);
      expect(transport.writtenText).toHaveLength(1);

      await scanner.disconnect();
    });
  });

  describe('readSecondBoundedFlashRangeExperimentM9', () => {
    it('throws ScannerNotConnectedError without writing when called before connect()', async () => {
      const scanner = new BioZoomScanner(transport);

      await expect(scanner.readSecondBoundedFlashRangeExperimentM9(21)).rejects.toBeInstanceOf(ScannerNotConnectedError);
      expect(transport.writtenText).toEqual([]);
    });

    it('rejects invalid measurement numbers without writing', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10 } });
      await scanner.connect();

      for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        await expect(scanner.readSecondBoundedFlashRangeExperimentM9(invalid)).rejects.toBeInstanceOf(RangeError);
      }
      expect(transport.writtenText).toEqual([]);

      await scanner.disconnect();
    });

    it('sends exactly one read-flash request for block=150 and range=150 and preserves the response', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10, responseTimeoutMs: 300 } });
      await scanner.connect();

      const pending = scanner.readSecondBoundedFlashRangeExperimentM9(21);
      await flushMicrotasks();

      expect(transport.writtenText).toHaveLength(1);
      const writtenLine = transport.writtenText[0]!;
      expect(writtenLine.endsWith('\n')).toBe(true);
      const [command, queryText] = writtenLine.trimEnd().split('?');
      const query = new URLSearchParams(queryText);
      expect(command).toBe('read-flash');
      expect(query.get('nr')).toBe('21');
      expect(query.get('block')).toBe('150');
      expect(query.get('range')).toBe('150');
      expect(query.get('call-index')).toBeTruthy();
      expect([...query.keys()].sort()).toEqual(['block', 'call-index', 'nr', 'range']);

      const responseWireBytes = encode('{"command":"read-flash","data_blocks_index":150,"data":["AA=="]}\r\n');
      transport.pushIncoming(responseWireBytes);
      const response = await pending;

      expect(response.kind).toBe('ok');
      expect(response.rawBytes).toEqual(responseWireBytes.slice(0, -1));
      if (response.kind === 'ok') {
        expect(response.json).toEqual({ command: 'read-flash', data_blocks_index: 150, data: ['AA=='] });
      }
      expect(transport.writtenText).toHaveLength(1);

      await scanner.disconnect();
    });

    it('propagates ProtocolClient response timeouts unchanged', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 5, responseTimeoutMs: 20 } });
      await scanner.connect();

      await expect(scanner.readSecondBoundedFlashRangeExperimentM9(21)).rejects.toBeInstanceOf(ProtocolResponseTimeoutError);
      expect(transport.writtenText).toHaveLength(1);

      await scanner.disconnect();
    });
  });

  describe('readThirdBoundedFlashRangeExperimentM10', () => {
    it('throws ScannerNotConnectedError without writing when called before connect()', async () => {
      const scanner = new BioZoomScanner(transport);
      await expect(scanner.readThirdBoundedFlashRangeExperimentM10(21)).rejects.toBeInstanceOf(ScannerNotConnectedError);
      expect(transport.writtenText).toEqual([]);
    });

    it('sends exactly one read-flash request for block=300 and range=150', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10, responseTimeoutMs: 300 } });
      await scanner.connect();

      const pending = scanner.readThirdBoundedFlashRangeExperimentM10(21);
      await flushMicrotasks();

      expect(transport.writtenText).toHaveLength(1);
      const [command, queryText] = transport.writtenText[0]!.trimEnd().split('?');
      const query = new URLSearchParams(queryText);
      expect(command).toBe('read-flash');
      expect(query.get('nr')).toBe('21');
      expect(query.get('block')).toBe('300');
      expect(query.get('range')).toBe('150');
      expect(query.get('call-index')).toBeTruthy();
      expect([...query.keys()].sort()).toEqual(['block', 'call-index', 'nr', 'range']);

      transport.pushIncoming(encode('{"command":"read-flash","data":[]}\r\n'));
      await expect(pending).resolves.toMatchObject({ kind: 'ok' });
      expect(transport.writtenText).toHaveLength(1);
      await scanner.disconnect();
    });

    it('propagates the first response timeout without retrying', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 5, responseTimeoutMs: 20 } });
      await scanner.connect();
      await expect(scanner.readThirdBoundedFlashRangeExperimentM10(21)).rejects.toBeInstanceOf(ProtocolResponseTimeoutError);
      expect(transport.writtenText).toHaveLength(1);
      await scanner.disconnect();
    });
  });

  describe('readFourthBoundedFlashRangeExperimentM11', () => {
    it('sends exactly one read-flash request for block=450 and range=150', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10, responseTimeoutMs: 300 } });
      await scanner.connect();
      const pending = scanner.readFourthBoundedFlashRangeExperimentM11(21);
      await flushMicrotasks();

      expect(transport.writtenText).toHaveLength(1);
      const [command, queryText] = transport.writtenText[0]!.trimEnd().split('?');
      const query = new URLSearchParams(queryText);
      expect(command).toBe('read-flash');
      expect(query.get('nr')).toBe('21');
      expect(query.get('block')).toBe('450');
      expect(query.get('range')).toBe('150');
      expect([...query.keys()].sort()).toEqual(['block', 'call-index', 'nr', 'range']);

      transport.pushIncoming(encode('{"command":"read-flash","data":[]}\r\n'));
      await pending;
      expect(transport.writtenText).toHaveLength(1);
      await scanner.disconnect();
    });
  });

  describe('readFifthBoundedFlashRangeExperimentM12', () => {
    it('sends exactly one read-flash request for block=600 and range=150', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10, responseTimeoutMs: 300 } });
      await scanner.connect();
      const pending = scanner.readFifthBoundedFlashRangeExperimentM12(21);
      await flushMicrotasks();

      expect(transport.writtenText).toHaveLength(1);
      const [command, queryText] = transport.writtenText[0]!.trimEnd().split('?');
      const query = new URLSearchParams(queryText);
      expect(command).toBe('read-flash');
      expect(query.get('nr')).toBe('21');
      expect(query.get('block')).toBe('600');
      expect(query.get('range')).toBe('150');
      expect([...query.keys()].sort()).toEqual(['block', 'call-index', 'nr', 'range']);

      transport.pushIncoming(encode('{"command":"read-flash","data":[]}\r\n'));
      await expect(pending).resolves.toMatchObject({ kind: 'ok' });
      expect(transport.writtenText).toHaveLength(1);
      await scanner.disconnect();
    });
  });

  describe.each([
    ['readAoxBoundaryLastBlockExperimentM13', '5772'],
    ['readAoxBoundaryBeyondEndExperimentM14', '5773'],
  ] as const)('%s', (method, block) => {
    it(`sends exactly one read-flash request for block=${block} and range=1`, async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10, responseTimeoutMs: 300 } });
      await scanner.connect();
      const pending = scanner[method](21);
      await flushMicrotasks();

      expect(transport.writtenText).toHaveLength(1);
      const [command, queryText] = transport.writtenText[0]!.trimEnd().split('?');
      const query = new URLSearchParams(queryText);
      expect(command).toBe('read-flash');
      expect(query.get('nr')).toBe('21');
      expect(query.get('block')).toBe(block);
      expect(query.get('range')).toBe('1');
      expect([...query.keys()].sort()).toEqual(['block', 'call-index', 'nr', 'range']);

      transport.pushIncoming(encode('{"command":"read-flash","data":[]}\r\n'));
      await expect(pending).resolves.toMatchObject({ kind: 'ok' });
      expect(transport.writtenText).toHaveLength(1);
      await scanner.disconnect();
    });
  });

  describe('runNonDestructiveLiveAoxExperimentM15', () => {
    it('uses only baseline status, one AOX start, bounded flash reads, and final status', async () => {
      const liveTransport = new LiveAoxTransport();
      const scanner = new BioZoomScanner(liveTransport, { protocol: { pollTimeoutMs: 10, responseTimeoutMs: 300 } });
      await scanner.connect();
      let tick = 0;
      let handGateCalled = false;
      const artifact = await scanner.runNonDestructiveLiveAoxExperimentM15({
        now: () => new Date(Date.UTC(2026, 7, 8, 20, 0, tick++)),
        getVisibleMeasurementCompletedAt: () => '2026-08-08T20:00:15.000Z',
        waitForHandReady: async () => {
          handGateCalled = true;
          expect(liveTransport.writtenText.map((text) => text.split('?')[0])).toEqual(['status']);
        },
      });

      const commands = liveTransport.writtenText.map((text) => text.split('?')[0]);
      expect(commands[0]).toBe('status');
      expect(commands[1]).toBe('measure');
      expect(commands.at(-1)).toBe('status');
      expect(commands.filter((command) => command === 'measure')).toHaveLength(1);
      expect(commands.filter((command) => command === 'read-flash')).toHaveLength(39);
      expect(commands).not.toContain('delete');
      expect(commands).not.toContain('erase-chip');
      expect(handGateCalled).toBe(true);
      expect(artifact.measurementNumber).toBe(22);
      expect(artifact.acquisition.complete).toBe(true);
      expect(artifact.acquisition.blocks).toHaveLength(5773);
      expect(artifact.visibleMeasurementCompletedAt).toBe('2026-08-08T20:00:15.000Z');
      await scanner.disconnect();
    });
  });

  describe('production AOX API', () => {
    it('prepares hand recognition with one status and then samples only hand commands', async () => {
      class HandTransport extends LiveAoxTransport {
        override async writeText(text: string): Promise<void> {
          const command = text.trim().split('?')[0];
          if (command === 'status' || command === 'hand') {
            await FakeTransport.prototype.writeText.call(this, text);
            const line = text.trim();
            const callIndex = new URLSearchParams(line.split('?')[1]).get('call-index');
            const payload = command === 'status'
              ? { command: line, 'call-index': callIndex, serial: 'scanner', wifi_firmware: '10.0.20' }
              : { command: line, 'call-index': callIndex, serial: 'scanner', data: [] };
            this.pushIncoming(encode(JSON.stringify(payload) + '\r\n'));
            return;
          }
          await super.writeText(text);
        }
      }
      const transport = new HandTransport();
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 10, responseTimeoutMs: 300 } });
      await scanner.connect();
      await scanner.identify();
      await scanner.prepareHandRecognition('present');
      await scanner.recognizeHand('present');
      await scanner.recognizeHand('present');
      const commands = transport.writtenText.map((text) => text.split('?')[0]);
      expect(commands.filter((command) => command === 'status')).toHaveLength(1);
      expect(commands.filter((command) => command === 'hand')).toHaveLength(2);
      expect(transport.writtenText.filter((text) => text.startsWith('hand?')).every((text) => text.includes('start=110') && text.includes('count=13') && text.includes('cycles=5'))).toBe(true);
      await scanner.disconnect();
    });

    it('requires identification, sends one bare delete before one start command, and preserves acknowledgment', async () => {
      const liveTransport = new LiveAoxTransport();
      const scanner = new BioZoomScanner(liveTransport, { protocol: { pollTimeoutMs: 10, responseTimeoutMs: 300 } });
      await scanner.connect();
      await expect(scanner.startAoxMeasurement()).rejects.toBeInstanceOf(ScannerNotIdentifiedError);
      await scanner.identify();
      const result = await scanner.startAoxMeasurement();
      expect(result.measurementNumber).toBe(22);
      expect(result.acknowledgment).toMatchObject({ kind: 'ok', json: { type: 'aox', measurement_nr: 22 } });
      const commands = liveTransport.writtenText.map((text) => text.split('?')[0]);
      expect(commands.slice(-2)).toEqual(['delete', 'measure']);
      expect(commands.filter((command) => command === 'delete')).toHaveLength(1);
      expect(commands.filter((command) => command === 'measure')).toHaveLength(1);
      expect(commands).not.toContain('erase-chip');
      expect(commands).not.toContain('e');
      expect(commands).not.toContain('flash_erase');
      await scanner.disconnect();
    });

    it('performs exactly one bare delete for each physical measurement start in a four-measurement series', async () => {
      const liveTransport = new LiveAoxTransport();
      const scanner = new BioZoomScanner(liveTransport, { protocol: { pollTimeoutMs: 10, responseTimeoutMs: 300 } });
      await scanner.connect();
      await scanner.identify();
      for (let measurement = 0; measurement < 4; measurement++) await scanner.startAoxMeasurement();
      const physicalCommands = liveTransport.writtenText
        .map((text) => text.trim().split('?')[0])
        .filter((command) => command === 'delete' || command === 'measure');
      expect(physicalCommands).toEqual([
        'delete', 'measure', 'delete', 'measure', 'delete', 'measure', 'delete', 'measure',
      ]);
      await scanner.disconnect();
    });

    it('does not send measure until the strictly correlated delete acknowledgment completes', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 5, responseTimeoutMs: 300 } });
      await scanner.connect();
      const identify = scanner.identify();
      await flushMicrotasks();
      transport.pushIncoming(encode(`{"command":"get_status","call-index":"${callIndexFromWrite(transport)}","serial":"scanner"}\n`));
      await identify;

      const started = scanner.startAoxMeasurement();
      await flushMicrotasks();
      expect(transport.writtenText.map((text) => text.trim().split('?')[0])).toEqual(['get_status', 'delete']);
      const deleteCallIndex = callIndexFromWrite(transport, 1);
      transport.pushIncoming(encode(`{"command":"delete?call-index=${deleteCallIndex}","call-index":"${deleteCallIndex}","status":"ok"}\n`));
      await vi.waitFor(() => expect(transport.writtenText).toHaveLength(3));
      expect(transport.writtenText[2]!.startsWith('measure?type=aox&call-index=')).toBe(true);
      const measureCallIndex = callIndexFromWrite(transport, 2);
      transport.pushIncoming(encode(`{"command":"measure?type=aox&call-index=${measureCallIndex}","call-index":"${measureCallIndex}","type":"aox","measurement_nr":75}\n`));
      await expect(started).resolves.toMatchObject({ measurementNumber: 75 });
      await scanner.disconnect();
    });

    it('cancellation while delete is pending prevents measurement start after delete acknowledges', async () => {
      const scanner = new BioZoomScanner(transport, { protocol: { pollTimeoutMs: 5, responseTimeoutMs: 300 } });
      await scanner.connect();
      const identify = scanner.identify();
      await flushMicrotasks();
      transport.pushIncoming(encode(`{"command":"get_status","call-index":"${callIndexFromWrite(transport)}","serial":"scanner"}\n`));
      await identify;
      const controller = new AbortController();
      const started = scanner.startAoxMeasurement({ signal: controller.signal });
      await flushMicrotasks();
      controller.abort('cancel-after-delete-send');
      const deleteCallIndex = callIndexFromWrite(transport, 1);
      transport.pushIncoming(encode(`{"command":"delete?call-index=${deleteCallIndex}","call-index":"${deleteCallIndex}","status":"ok"}\n`));
      await expect(started).rejects.toBe('cancel-after-delete-send');
      expect(transport.writtenText.map((text) => text.trim().split('?')[0])).toEqual(['get_status', 'delete']);
      await scanner.disconnect();
    });

    it('rejects malformed start acknowledgments with a typed error', async () => {
      class MalformedAckTransport extends LiveAoxTransport {
        override async writeText(text: string): Promise<void> {
          if (text.startsWith('measure?')) {
            await FakeTransport.prototype.writeText.call(this, text);
            const callIndex = new URLSearchParams(text.trim().split('?')[1]).get('call-index');
            this.pushIncoming(encode(JSON.stringify({ command: text.trim(), 'call-index': callIndex, type: 'aox' }) + '\r\n'));
            return;
          }
          await super.writeText(text);
        }
      }
      const scanner = new BioZoomScanner(new MalformedAckTransport(), { protocol: { pollTimeoutMs: 10, responseTimeoutMs: 300 } });
      await scanner.connect();
      await scanner.identify();
      await expect(scanner.startAoxMeasurement()).rejects.toBeInstanceOf(MalformedAoxMeasurementAcknowledgmentError);
      await scanner.disconnect();
    });

    it('rejects correlated AOX-shaped data that does not acknowledge the measure command', async () => {
      class WrongCommandAckTransport extends LiveAoxTransport {
        override async writeText(text: string): Promise<void> {
          if (text.startsWith('measure?')) {
            await FakeTransport.prototype.writeText.call(this, text);
            const callIndex = new URLSearchParams(text.trim().split('?')[1]).get('call-index');
            this.pushIncoming(encode(JSON.stringify({ command: `hand?call-index=${callIndex}`, 'call-index': callIndex, type: 'aox', measurement_nr: 22 }) + '\r\n'));
            return;
          }
          await super.writeText(text);
        }
      }
      const scanner = new BioZoomScanner(new WrongCommandAckTransport(), { protocol: { pollTimeoutMs: 10, responseTimeoutMs: 300 } });
      await scanner.connect();
      await scanner.identify();
      await expect(scanner.startAoxMeasurement()).rejects.toBeInstanceOf(MalformedAoxMeasurementAcknowledgmentError);
      await scanner.disconnect();
    });

    it('preserves a rejected start response in a typed error', async () => {
      class RejectedStartTransport extends LiveAoxTransport {
        override async writeText(text: string): Promise<void> {
          if (text.startsWith('measure?')) {
            await FakeTransport.prototype.writeText.call(this, text);
            const callIndex = new URLSearchParams(text.trim().split('?')[1]).get('call-index');
            this.pushIncoming(encode(JSON.stringify({ command: text.trim(), 'call-index': callIndex, type: 'error' }) + '\r\n'));
            return;
          }
          await super.writeText(text);
        }
      }
      const scanner = new BioZoomScanner(new RejectedStartTransport(), { protocol: { pollTimeoutMs: 10, responseTimeoutMs: 300 } });
      await scanner.connect();
      await scanner.identify();
      const rejection = await scanner.startAoxMeasurement().catch((error: unknown) => error);
      expect(rejection).toBeInstanceOf(AoxMeasurementStartRejectedError);
      expect((rejection as AoxMeasurementStartRejectedError).response).toMatchObject({ kind: 'error' });
      await scanner.disconnect();
    });

    it('downloads through protocol with no destructive commands', async () => {
      const liveTransport = new LiveAoxTransport();
      const scanner = new BioZoomScanner(liveTransport, { protocol: { pollTimeoutMs: 10, responseTimeoutMs: 300 } });
      await scanner.connect();
      await scanner.identify();
      const artifact = await scanner.downloadAoxMeasurement(22, {
        profile: { type: 'aox', logicalBlockCount: 3, blockByteLength: 33 }, range: 2,
      });
      expect(artifact.summary.complete).toBe(true);
      expect(artifact.scannerSerial).toBe('scanner');
      const commands = liveTransport.writtenText.map((text) => text.split('?')[0]);
      expect(commands.filter((command) => command === 'read-flash')).toHaveLength(2);
      expect(commands).not.toContain('delete');
      expect(commands).not.toContain('erase-chip');
      await scanner.disconnect();
    });
  });
});
