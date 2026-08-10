import { describe, expect, it, vi } from 'vitest';
import type { ParsedResponse, ScannerIdentity } from '@nutriscan/scanner';
import {
  SCANNER_DELETE_ONCE_EXECUTION_PHRASE,
  ScannerDeleteOnceDiagnosticRunner,
  type ScannerDeleteOnceDiagnosticScanner,
} from './scanner-delete-once-diagnostic';

function response(command: string, json: Record<string, unknown>): ParsedResponse {
  return { kind: 'ok', rawBytes: new Uint8Array([9]), strippedLeadingByteCount: 0, text: 'private', json: { command, ...json }, command, callIndex: 'private-call', serial: 'private-serial' };
}

function harness() {
  const identifyResponse = response('get_status', { serial: 'private' });
  const identity = { serial: 'private', protocolVersion: 'v2', commandUsed: 'get_status', response: identifyResponse } satisfies ScannerIdentity;
  const scanner: ScannerDeleteOnceDiagnosticScanner = {
    connect: vi.fn().mockResolvedValue(undefined),
    identify: vi.fn().mockResolvedValue(identity),
    readStatusSnapshot: vi.fn()
      .mockResolvedValueOnce(response('status', { busy: 0, sensor_unique: 'private-hardware-id', last_measurement_nr: 73 }))
      .mockResolvedValueOnce(response('status', { busy: 0, sensor_unique: 'private-hardware-id', last_measurement_nr: 73 })),
    deleteMeasurementStorageOnceDiagnostic: vi.fn().mockResolvedValue(response('delete', { status: 'ok' })),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
  const dates = [new Date('2026-08-10T00:00:00Z'), new Date('2026-08-10T00:00:01Z'), new Date('2026-08-10T00:00:02Z')];
  return { scanner, runner: new ScannerDeleteOnceDiagnosticRunner(scanner, () => dates.shift()!) };
}

describe('permissioned single bare-delete diagnostic', () => {
  it('does nothing without the exact authorization phrase', async () => {
    const h = harness();
    await expect(h.runner.execute('')).rejects.toThrow('not explicitly authorized');
    expect(h.scanner.connect).not.toHaveBeenCalled();
    expect(h.scanner.deleteMeasurementStorageOnceDiagnostic).not.toHaveBeenCalled();
  });

  it('performs one delete between exactly two status snapshots and disconnects', async () => {
    const h = harness();
    const result = await h.runner.execute(SCANNER_DELETE_ONCE_EXECUTION_PHRASE);
    expect(h.scanner.connect).toHaveBeenCalledOnce();
    expect(h.scanner.identify).toHaveBeenCalledOnce();
    expect(h.scanner.readStatusSnapshot).toHaveBeenCalledTimes(2);
    expect(h.scanner.deleteMeasurementStorageOnceDiagnostic).toHaveBeenCalledOnce();
    expect(h.scanner.disconnect).toHaveBeenCalledOnce();
    expect(result.deleteAcknowledgment).toEqual({
      command: 'delete', sentAt: '2026-08-10T00:00:00.000Z', responseAt: '2026-08-10T00:00:01.000Z',
      responseReceived: true, strictlyCorrelated: true, responseKind: 'ok', responseCommandMatches: true,
    });
    expect(result.beforeStatus).toEqual({ busy: 0, last_measurement_nr: 73 });
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('does not retry a failed delete and still captures the second status', async () => {
    const h = harness();
    vi.mocked(h.scanner.deleteMeasurementStorageOnceDiagnostic).mockRejectedValueOnce(new Error('raw private failure'));
    const result = await h.runner.execute(SCANNER_DELETE_ONCE_EXECUTION_PHRASE);
    expect(h.scanner.deleteMeasurementStorageOnceDiagnostic).toHaveBeenCalledOnce();
    expect(h.scanner.readStatusSnapshot).toHaveBeenCalledTimes(2);
    expect(result.deleteAcknowledgment).toMatchObject({ responseReceived: false, diagnostic: 'DELETE_RESPONSE_FAILED' });
    expect(JSON.stringify(result)).not.toContain('raw private failure');
  });

  it('always disconnects if a status operation fails', async () => {
    const h = harness();
    vi.mocked(h.scanner.readStatusSnapshot).mockReset().mockRejectedValueOnce(new Error('status failed'));
    await expect(h.runner.execute(SCANNER_DELETE_ONCE_EXECUTION_PHRASE)).rejects.toThrow('status failed');
    expect(h.scanner.deleteMeasurementStorageOnceDiagnostic).not.toHaveBeenCalled();
    expect(h.scanner.disconnect).toHaveBeenCalledOnce();
  });
});
