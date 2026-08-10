import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ParsedResponse, ScannerIdentity, TransportLogger } from '@nutriscan/scanner';
import {
  executeDiagnostic,
  createFileTranscriptWriter,
  type DiagnosticScanner,
  type DiagnosticTranscript,
} from '../src/diagnostics.js';

const rawFrame = Uint8Array.from([0x7b, 0x7d, 0x0d]);
const response: ParsedResponse = {
  kind: 'ok', rawBytes: rawFrame, strippedLeadingByteCount: 0, text: '{}\r', json: {},
  command: 'get_status', serial: 'scanner-1', callIndex: undefined,
};
const identity: ScannerIdentity = {
  serial: 'scanner-1', protocolVersion: 'v2', commandUsed: 'get_status', response,
};

describe('diagnostic transcripts', () => {
  it('preserves exact raw TX/RX bytes, timestamps, and parsed raw frame bytes', async () => {
    let transportLogger: TransportLogger | undefined;
    const scanner: DiagnosticScanner = {
      connect: vi.fn(async () => {
        transportLogger?.onRawBytes?.('write', Uint8Array.from([0x61, 0x0a]));
        transportLogger?.onRawBytes?.('read', Uint8Array.from([0x7b, 0x7d, 0x0d, 0x0a]));
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
      identify: vi.fn().mockResolvedValue(identity),
      captureStatusExperimentM2: vi.fn().mockResolvedValue(response),
      readFirstThreeFlashBlocksExperimentM7: vi.fn().mockResolvedValue(response),
      readSecondBoundedFlashRangeExperimentM9: vi.fn().mockResolvedValue(response),
      readThirdBoundedFlashRangeExperimentM10: vi.fn().mockResolvedValue(response),
      readFourthBoundedFlashRangeExperimentM11: vi.fn().mockResolvedValue(response),
      readFifthBoundedFlashRangeExperimentM12: vi.fn().mockResolvedValue(response),
      readAoxBoundaryLastBlockExperimentM13: vi.fn().mockResolvedValue(response),
      readAoxBoundaryBeyondEndExperimentM14: vi.fn().mockResolvedValue(response),
      downloadCompletedAoxMeasurement21Experiment: vi.fn().mockResolvedValue({
        experimental: true, measurementNumber: 21, expectedLogicalBlockCount: 5773, initialRange: 150,
        startedAt: '2026-08-08T20:00:00.000Z', completedAt: '2026-08-08T20:00:01.000Z', complete: true,
        blocks: [], originalBase64Blocks: [], measurementBlocks: '', missingLogicalIndexes: [], reads: [], anomalies: [], retryRounds: 0,
      }),
      runNonDestructiveLiveAoxExperimentM15: vi.fn(),
      startAoxMeasurement: vi.fn(),
      downloadAoxMeasurement: vi.fn(),
    };
    let saved: DiagnosticTranscript | undefined;

    const result = await executeDiagnostic({ action: 'identify', port: '/dev/tty.usbmodem1' }, {
      createScanner: (_port, logger) => {
        transportLogger = logger;
        return scanner;
      },
      analyzeM7: vi.fn(),
      analyzeM9: vi.fn(),
      analyzeM10: vi.fn(),
      analyzeM11: vi.fn(),
      analyzeM12: vi.fn(),
      analyzeM13: vi.fn(),
      analyzeM14: vi.fn(),
      writeTranscript: async (transcript) => {
        saved = transcript;
        return '/tmp/transcript.json';
      },
      waitForHandReady: vi.fn().mockResolvedValue(undefined),
      buildOfflineScoringProposal: vi.fn(),
      sleep: vi.fn().mockResolvedValue(undefined),
      now: () => new Date('2026-08-08T20:00:00.000Z'),
    }, { log: vi.fn() });

    expect(result.file).toBe('/tmp/transcript.json');
    expect(saved?.raw).toEqual([
      { timestamp: '2026-08-08T20:00:00.000Z', direction: 'write', hex: '61 0a', bytes: [0x61, 0x0a] },
      { timestamp: '2026-08-08T20:00:00.000Z', direction: 'read', hex: '7b 7d 0d 0a', bytes: [0x7b, 0x7d, 0x0d, 0x0a] },
    ]);
    expect(saved?.identity).toMatchObject({
      response: { rawBytes: { hex: '7b 7d 0d', bytes: [0x7b, 0x7d, 0x0d] } },
    });
  });

  it('writes preserved raw byte arrays and hex to machine-readable JSON', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'nutriscan-diagnostic-'));
    try {
      const transcript: DiagnosticTranscript = {
        schemaVersion: 1,
        experimental: true,
        action: 'identify',
        port: '/dev/tty.usbmodem1',
        startedAt: '2026-08-08T20:00:00.000Z',
        completedAt: '2026-08-08T20:00:01.000Z',
        scannerSerial: 'scanner-1',
        protocolVersion: 'v2',
        raw: [{ timestamp: '2026-08-08T20:00:00.500Z', direction: 'read', hex: '00 0d 0a', bytes: [0, 13, 10] }],
        identityCapturedAt: '2026-08-08T20:00:00.600Z',
        responseCapturedAt: null,
        identity: null,
        response: null,
        analysis: null,
        error: null,
      };

      const destination = await createFileTranscriptWriter(directory)(transcript);
      const stored = JSON.parse(await readFile(destination, 'utf8')) as DiagnosticTranscript;

      expect(stored.raw).toEqual(transcript.raw);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
