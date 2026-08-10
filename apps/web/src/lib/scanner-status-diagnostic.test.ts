import { describe, expect, it, vi } from 'vitest';
import type { ParsedResponse, ScannerIdentity } from '@nutriscan/scanner';
import {
  SCANNER_STATUS_EXECUTION_PHRASE,
  ScannerStatusDiagnosticRunner,
  sanitizeStatusObject,
  type ScannerStatusDiagnosticScanner,
} from './scanner-status-diagnostic';

function parsedStatus(json: Record<string, unknown>): ParsedResponse {
  return { kind: 'ok', rawBytes: new Uint8Array([1, 2, 3]), strippedLeadingByteCount: 0, text: 'private raw status', json, command: 'status', serial: 'private-serial', callIndex: 'private-call' };
}

function harness(status = parsedStatus({ busy: 0, last_measurement_nr: 74 })) {
  const identity = { serial: 'private-serial', protocolVersion: 'v2', commandUsed: 'get_status', response: status } satisfies ScannerIdentity;
  const scanner: ScannerStatusDiagnosticScanner = {
    connect: vi.fn().mockResolvedValue(undefined),
    identify: vi.fn().mockResolvedValue(identity),
    readStatusSnapshot: vi.fn().mockResolvedValue(status),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
  return { scanner, runner: new ScannerStatusDiagnosticRunner(scanner), status };
}

describe('status-only diagnostic authorization', () => {
  it('does nothing without the exact explicit execution phrase', async () => {
    const h = harness();
    await expect(h.runner.execute('')).rejects.toThrow('not explicitly authorized');
    expect(h.scanner.connect).not.toHaveBeenCalled();
    expect(h.scanner.identify).not.toHaveBeenCalled();
    expect(h.scanner.readStatusSnapshot).not.toHaveBeenCalled();
  });

  it('performs only connect, identify, one status snapshot, and disconnect', async () => {
    const h = harness();
    await expect(h.runner.execute(SCANNER_STATUS_EXECUTION_PHRASE)).resolves.toMatchObject({
      protocol: 'v2', identificationCommand: 'get_status', statusFields: { busy: 0, last_measurement_nr: 74 },
    });
    expect(h.scanner.connect).toHaveBeenCalledOnce();
    expect(h.scanner.identify).toHaveBeenCalledOnce();
    expect(h.scanner.readStatusSnapshot).toHaveBeenCalledOnce();
    expect(h.scanner.disconnect).toHaveBeenCalledOnce();
    expect(h.runner.rawStatusForLocalInspection).toBe(h.status);
  });

  it('disconnects if identification or status fails', async () => {
    const h = harness();
    vi.mocked(h.scanner.readStatusSnapshot).mockRejectedValueOnce(new Error('status failed'));
    await expect(h.runner.execute(SCANNER_STATUS_EXECUTION_PHRASE)).rejects.toThrow('status failed');
    expect(h.scanner.disconnect).toHaveBeenCalledOnce();
  });
});

describe('status sanitization', () => {
  it('preserves known and unknown health fields while removing identity, network, and protocol material', () => {
    const sanitized = sanitizeStatusObject({
      command: 'status?call-index=secret', serial: 'secret', host: 'secret', ip: 'secret', wifi_name: 'secret',
      sensor_unique: '0080152D0F80BB0500040020000000008E0B', device_id: 'secret',
      nested: { hardware_identifier: 'secret', health: 'ok' },
      nuvoton_chip_id: 'secret', token: 'secret', busy: 1, last_measurement_nr: 74,
      memory_free_64k_blocks: 0, memory_healthy: false, battery_voltage: 3.9,
      capabilities: { SUPPORT_SPI_MEMORY: true, AP_PASS: 'secret', UNKNOWN_HEALTH_FLAG: 7 },
      future_storage_error: 'full',
    });
    expect(sanitized).toEqual({
      busy: 1, last_measurement_nr: 74, memory_free_64k_blocks: 0, memory_healthy: false,
      battery_voltage: 3.9, capabilities: { SUPPORT_SPI_MEMORY: true, UNKNOWN_HEALTH_FLAG: 7 },
      future_storage_error: 'full', nested: { health: 'ok' },
    });
    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('serial');
    expect(serialized).not.toContain('call-index');
    expect(serialized).not.toContain('0080152D0F80BB0500040020000000008E0B');
  });
});
