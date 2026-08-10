import { describe, expect, it, vi } from 'vitest';
import type { M7FlashAnalysis, ParsedResponse, ScannerIdentity, TransportLogger } from '@nutriscan/scanner';
import { runCli, type CliDependencies, type CliIo } from '../src/app.js';
import type { DiagnosticScanner, DiagnosticTranscript } from '../src/diagnostics.js';

const response: ParsedResponse = {
  kind: 'ok',
  rawBytes: Uint8Array.from([0x7b, 0x7d, 0x0d]),
  strippedLeadingByteCount: 0,
  text: '{}\r',
  json: {},
  command: 'get_status',
  serial: 'scanner-1',
  callIndex: undefined,
};

const identity: ScannerIdentity = {
  serial: 'scanner-1',
  protocolVersion: 'v2',
  commandUsed: 'get_status',
  response,
};

function createIo(): CliIo & { output: string[]; errors: string[] } {
  const output: string[] = [];
  const errors: string[] = [];
  return { output, errors, stdout: (message) => output.push(message), stderr: (message) => errors.push(message) };
}

function createScanner(): DiagnosticScanner & Record<string, ReturnType<typeof vi.fn>> {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
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
    runNonDestructiveLiveAoxExperimentM15: vi.fn().mockImplementation(async (options) => {
      await options?.waitForHandReady?.();
      return {
        experimental: true,
        startedAt: '2026-08-08T20:00:00.000Z', baselineStatusCapturedAt: '2026-08-08T20:00:00.000Z', baselineStatus: response,
        measurementCommandSentAt: '2026-08-08T20:00:00.000Z', measurementAcknowledgedAt: '2026-08-08T20:00:00.000Z', measurementAcknowledgment: response,
        measurementNumber: 22, firstReadableBlockAt: null, finalBlockAvailableAt: null, visibleMeasurementCompletedAt: null,
        finalStatusCapturedAt: '2026-08-08T20:00:01.000Z', finalStatus: response, completedAt: '2026-08-08T20:00:01.000Z',
        acquisition: {
          experimental: true, measurementNumber: 22, expectedLogicalBlockCount: 5773, initialRange: 150,
          startedAt: '2026-08-08T20:00:00.000Z', completedAt: '2026-08-08T20:00:01.000Z', complete: true,
          blocks: [], originalBase64Blocks: [], measurementBlocks: 'payload', missingLogicalIndexes: [], reads: [], anomalies: [], retryRounds: 0,
        },
      };
    }),
    startAoxMeasurement: vi.fn().mockResolvedValue({
      measurementNumber: 23,
      type: 'aox',
      acknowledgedAt: '2026-08-08T20:00:00.000Z',
      response,
    }),
    downloadAoxMeasurement: vi.fn().mockResolvedValue({
      scannerSerial: 'scanner-1', measurementNumber: 23, type: 'aox',
      profile: { logicalBlockCount: 5773 }, blocks: Array.from({ length: 5773 }),
      originalBase64Blocks: [], measurementBlocks: 'official-shaped-payload', missingLogicalIndexes: [], missingRanges: [], anomalies: [],
      summary: { expectedBlockCount: 5773, validBlockCount: 5773, missingBlockCount: 0, anomalyCount: 0, complete: true },
      startedAt: '2026-08-08T20:00:00.000Z', completedAt: '2026-08-08T20:00:01.000Z', reads: [], retryRounds: 0, failure: null,
    }),
  };
}

function createDependencies(scanner = createScanner()) {
  const writeTranscript = vi.fn<(transcript: DiagnosticTranscript) => Promise<string>>().mockResolvedValue('/tmp/transcript.json');
  const dependencies: CliDependencies = {
    listPorts: vi.fn().mockResolvedValue([{
      path: '/dev/tty.usbmodem1', manufacturer: 'Nuvoton', serialNumber: undefined,
      pnpId: undefined, locationId: undefined, productId: undefined, vendorId: undefined,
    }]),
    createScanner: vi.fn((_port: string, _logger: TransportLogger) => scanner),
    analyzeM7: vi.fn((_response: ParsedResponse): M7FlashAnalysis => ({ kind: 'analyzed', returnedElementCount: 0, blocks: [] })),
    analyzeM9: vi.fn((_response: ParsedResponse): M7FlashAnalysis => ({ kind: 'analyzed', returnedElementCount: 0, blocks: [] })),
    analyzeM10: vi.fn((_response: ParsedResponse): M7FlashAnalysis => ({ kind: 'analyzed', returnedElementCount: 0, blocks: [] })),
    analyzeM11: vi.fn((_response: ParsedResponse): M7FlashAnalysis => ({ kind: 'analyzed', returnedElementCount: 0, blocks: [] })),
    analyzeM12: vi.fn((_response: ParsedResponse): M7FlashAnalysis => ({ kind: 'analyzed', returnedElementCount: 0, blocks: [] })),
    analyzeM13: vi.fn((_response: ParsedResponse): M7FlashAnalysis => ({ kind: 'analyzed', returnedElementCount: 0, blocks: [] })),
    analyzeM14: vi.fn((_response: ParsedResponse): M7FlashAnalysis => ({ kind: 'analyzed', returnedElementCount: 0, blocks: [] })),
    writeTranscript,
    waitForHandReady: vi.fn().mockResolvedValue(undefined),
    buildOfflineScoringProposal: vi.fn((artifact) => ({
      acquisition: {
        scannerSerial: { value: artifact.scannerSerial, classification: 'hardware confirmed', basis: 'test' },
        measurementNumber: { value: artifact.measurementNumber, classification: 'hardware confirmed', basis: 'test' },
        blockCount: { value: 5773, classification: 'hardware confirmed', basis: 'test' },
        measurementBlocksLength: { value: artifact.measurementBlocks.length, classification: 'runtime confirmed', basis: 'test' },
        measurementBlocksSha256: { value: 'a'.repeat(64), classification: 'runtime confirmed', basis: 'test' },
      },
      preRequest: {}, measureRequest: { measureJson: { value: { MeasurementBlocks: artifact.measurementBlocks } } },
      fieldEvidence: {}, omittedOfficialFields: {}, networkTransmission: { value: false, classification: 'runtime confirmed', basis: 'test' },
    }) as never),
    sleep: vi.fn().mockResolvedValue(undefined),
    now: () => new Date('2026-08-08T20:00:00.000Z'),
  };
  return { dependencies, scanner, writeTranscript };
}

describe('permissioned scanner CLI', () => {
  it('keeps list metadata-only and never creates a scanner', async () => {
    const { dependencies } = createDependencies();
    const io = createIo();

    await expect(runCli(['list', '--json'], dependencies, io)).resolves.toBe(0);

    expect(dependencies.listPorts).toHaveBeenCalledOnce();
    expect(dependencies.createScanner).not.toHaveBeenCalled();
    expect(JSON.parse(io.output[0] ?? 'null')[0].path).toBe('/dev/tty.usbmodem1');
  });

  it('dry-runs diagnostics without listing, opening, or writing', async () => {
    const { dependencies, writeTranscript } = createDependencies();
    const io = createIo();

    await expect(runCli(['identify', '--port', '/dev/tty.usbmodem1'], dependencies, io)).resolves.toBe(0);

    expect(dependencies.listPorts).not.toHaveBeenCalled();
    expect(dependencies.createScanner).not.toHaveBeenCalled();
    expect(writeTranscript).not.toHaveBeenCalled();
    expect(io.output[0]).toContain('No port was opened and no bytes were sent');
  });

  it('dry-runs M15 without opening, prompting, or transmitting', async () => {
    const { dependencies, writeTranscript } = createDependencies();
    const io = createIo();

    await expect(runCli(['experiment', 'M15', '--port', '/dev/tty.usbmodem1'], dependencies, io)).resolves.toBe(0);

    expect(dependencies.createScanner).not.toHaveBeenCalled();
    expect(dependencies.waitForHandReady).not.toHaveBeenCalled();
    expect(writeTranscript).not.toHaveBeenCalled();
    expect(io.output[0]).toContain('wait for explicit ENTER');
  });

  it('dry-runs offline scoring without opening, prompting, acquiring, or constructing a payload', async () => {
    const { dependencies, scanner, writeTranscript } = createDependencies();
    const io = createIo();

    await expect(runCli(
      ['offline-score', '--port', '/dev/tty.usbmodem1', '--lang', 'EN'], dependencies, io,
    )).resolves.toBe(0);

    expect(dependencies.createScanner).not.toHaveBeenCalled();
    expect(dependencies.waitForHandReady).not.toHaveBeenCalled();
    expect(scanner.startAoxMeasurement).not.toHaveBeenCalled();
    expect(dependencies.buildOfflineScoringProposal).not.toHaveBeenCalled();
    expect(writeTranscript).not.toHaveBeenCalled();
    expect(io.output[0]).toContain('no HTTP request will be made');
  });

  it.each([
    ['identify', '--execute'],
    ['experiment', 'M8', '--port', '/dev/tty.usbmodem1', '--execute'],
    ['status', '--port', '--execute'],
    ['open', '--port', '/dev/tty.usbmodem1', '--execute'],
    ['offline-score', '--port', '/dev/tty.usbmodem1', '--execute'],
    ['offline-score', '--port', '/dev/tty.usbmodem1', '--lang', 'english', '--execute'],
  ])('rejects invalid action/port arguments before creating a scanner: %s', async (...args) => {
    const { dependencies } = createDependencies();
    const io = createIo();

    await expect(runCli(args, dependencies, io)).resolves.toBe(2);

    expect(dependencies.createScanner).not.toHaveBeenCalled();
    expect(dependencies.listPorts).not.toHaveBeenCalled();
  });

  it('executes identify through the scanner abstraction and disconnects', async () => {
    const { dependencies, scanner } = createDependencies();
    const io = createIo();

    await expect(runCli(['identify', '--port', '/dev/tty.usbmodem1', '--execute'], dependencies, io)).resolves.toBe(0);

    expect(dependencies.createScanner).toHaveBeenCalledWith('/dev/tty.usbmodem1', expect.any(Object));
    expect(scanner.connect).toHaveBeenCalledOnce();
    expect(scanner.identify).toHaveBeenCalledOnce();
    expect(scanner.captureStatusExperimentM2).not.toHaveBeenCalled();
    expect(scanner.readFirstThreeFlashBlocksExperimentM7).not.toHaveBeenCalled();
    expect(scanner.readSecondBoundedFlashRangeExperimentM9).not.toHaveBeenCalled();
    expect(scanner.readThirdBoundedFlashRangeExperimentM10).not.toHaveBeenCalled();
    expect(scanner.disconnect).toHaveBeenCalledOnce();
  });

  it('runs only the named M9 scanner method once with fixed measurement 21', async () => {
    const { dependencies, scanner } = createDependencies();
    const io = createIo();

    await expect(runCli(
      ['experiment', 'M9', '--port', '/dev/tty.usbmodem1', '--execute'], dependencies, io,
    )).resolves.toBe(0);

    expect(scanner.identify).toHaveBeenCalledOnce();
    expect(scanner.readSecondBoundedFlashRangeExperimentM9).toHaveBeenCalledOnce();
    expect(scanner.readSecondBoundedFlashRangeExperimentM9).toHaveBeenCalledWith(21);
    expect(scanner.readFirstThreeFlashBlocksExperimentM7).not.toHaveBeenCalled();
    expect(scanner.captureStatusExperimentM2).not.toHaveBeenCalled();
    expect(scanner.disconnect).toHaveBeenCalledOnce();
  });

  it('runs only the named M10 scanner method once with fixed measurement 21', async () => {
    const { dependencies, scanner } = createDependencies();
    const io = createIo();

    await expect(runCli(
      ['experiment', 'M10', '--port', '/dev/tty.usbmodem1', '--execute'], dependencies, io,
    )).resolves.toBe(0);

    expect(scanner.identify).toHaveBeenCalledOnce();
    expect(scanner.readThirdBoundedFlashRangeExperimentM10).toHaveBeenCalledOnce();
    expect(scanner.readThirdBoundedFlashRangeExperimentM10).toHaveBeenCalledWith(21);
    expect(scanner.readSecondBoundedFlashRangeExperimentM9).not.toHaveBeenCalled();
    expect(scanner.readFirstThreeFlashBlocksExperimentM7).not.toHaveBeenCalled();
    expect(scanner.captureStatusExperimentM2).not.toHaveBeenCalled();
    expect(scanner.disconnect).toHaveBeenCalledOnce();
  });

  it('runs only the named M7 scanner method once with fixed measurement 21', async () => {
    const { dependencies, scanner } = createDependencies();
    const io = createIo();

    await expect(runCli(
      ['experiment', 'M7', '--port', '/dev/tty.usbmodem1', '--execute'], dependencies, io,
    )).resolves.toBe(0);

    expect(scanner.identify).toHaveBeenCalledOnce();
    expect(scanner.readFirstThreeFlashBlocksExperimentM7).toHaveBeenCalledOnce();
    expect(scanner.readFirstThreeFlashBlocksExperimentM7).toHaveBeenCalledWith(21);
    expect(scanner.captureStatusExperimentM2).not.toHaveBeenCalled();
    expect(scanner.disconnect).toHaveBeenCalledOnce();
  });

  it('runs only the named M12 scanner method once with fixed measurement 21', async () => {
    const { dependencies, scanner } = createDependencies();
    const io = createIo();

    await expect(runCli(
      ['experiment', 'M12', '--port', '/dev/tty.usbmodem1', '--execute'], dependencies, io,
    )).resolves.toBe(0);

    expect(scanner.identify).toHaveBeenCalledOnce();
    expect(scanner.readFifthBoundedFlashRangeExperimentM12).toHaveBeenCalledOnce();
    expect(scanner.readFifthBoundedFlashRangeExperimentM12).toHaveBeenCalledWith(21);
    expect(scanner.readFourthBoundedFlashRangeExperimentM11).not.toHaveBeenCalled();
    expect(scanner.readThirdBoundedFlashRangeExperimentM10).not.toHaveBeenCalled();
    expect(scanner.readSecondBoundedFlashRangeExperimentM9).not.toHaveBeenCalled();
    expect(scanner.readFirstThreeFlashBlocksExperimentM7).not.toHaveBeenCalled();
    expect(scanner.captureStatusExperimentM2).not.toHaveBeenCalled();
    expect(scanner.disconnect).toHaveBeenCalledOnce();
  });

  it.each([
    ['M13', 'readAoxBoundaryLastBlockExperimentM13'],
    ['M14', 'readAoxBoundaryBeyondEndExperimentM14'],
  ])('runs only fixed boundary action %s once', async (action, method) => {
    const { dependencies, scanner } = createDependencies();
    const io = createIo();

    await expect(runCli(
      ['experiment', action, '--port', '/dev/tty.usbmodem1', '--execute'], dependencies, io,
    )).resolves.toBe(0);

    expect(scanner.identify).toHaveBeenCalledOnce();
    expect(scanner[method]).toHaveBeenCalledOnce();
    expect(scanner[method]).toHaveBeenCalledWith(21);
    const otherMethod = action === 'M13'
      ? 'readAoxBoundaryBeyondEndExperimentM14'
      : 'readAoxBoundaryLastBlockExperimentM13';
    expect(scanner[otherMethod]).not.toHaveBeenCalled();
    expect(scanner.captureStatusExperimentM2).not.toHaveBeenCalled();
    expect(scanner.disconnect).toHaveBeenCalledOnce();
  });

  it('runs only the explicitly named complete measurement-21 downloader', async () => {
    const { dependencies, scanner } = createDependencies();
    const io = createIo();

    await expect(runCli(
      ['download', 'M21', '--port', '/dev/tty.usbmodem1', '--execute'], dependencies, io,
    )).resolves.toBe(0);

    expect(scanner.identify).toHaveBeenCalledOnce();
    expect(scanner.downloadCompletedAoxMeasurement21Experiment).toHaveBeenCalledOnce();
    expect(scanner.readAoxBoundaryLastBlockExperimentM13).not.toHaveBeenCalled();
    expect(scanner.readAoxBoundaryBeyondEndExperimentM14).not.toHaveBeenCalled();
    expect(scanner.captureStatusExperimentM2).not.toHaveBeenCalled();
    expect(scanner.disconnect).toHaveBeenCalledOnce();
  });

  it('runs M15 through the scanner abstraction and supplies exactly one human gate', async () => {
    const { dependencies, scanner, writeTranscript } = createDependencies();
    const io = createIo();

    await expect(runCli(
      ['experiment', 'M15', '--port', '/dev/tty.usbmodem1', '--execute'], dependencies, io,
    )).resolves.toBe(0);

    expect(scanner.identify).toHaveBeenCalledOnce();
    expect(scanner.runNonDestructiveLiveAoxExperimentM15).toHaveBeenCalledOnce();
    expect(dependencies.waitForHandReady).toHaveBeenCalledOnce();
    expect(scanner.downloadCompletedAoxMeasurement21Experiment).not.toHaveBeenCalled();
    expect(scanner.captureStatusExperimentM2).not.toHaveBeenCalled();
    expect(scanner.disconnect).toHaveBeenCalledOnce();
    const transcript = writeTranscript.mock.calls[0]?.[0];
    expect(transcript?.measurementBlocksSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(transcript?.liveAcquisitionArtifact?.acquisition.measurementBlocks).toBe('payload');
  });

  it('runs one production AOX acquisition and preserves the offline proposal in the transcript', async () => {
    const { dependencies, scanner, writeTranscript } = createDependencies();
    const io = createIo();

    await expect(runCli(
      ['offline-score', '--port', '/dev/tty.usbmodem1', '--lang', 'EN', '--execute'], dependencies, io,
    )).resolves.toBe(0);

    expect(scanner.identify).toHaveBeenCalledOnce();
    expect(dependencies.waitForHandReady).toHaveBeenCalledOnce();
    expect(scanner.startAoxMeasurement).toHaveBeenCalledOnce();
    expect(scanner.downloadAoxMeasurement).toHaveBeenCalledOnce();
    expect(scanner.downloadAoxMeasurement).toHaveBeenCalledWith(23, expect.objectContaining({ range: 150 }));
    expect(scanner.runNonDestructiveLiveAoxExperimentM15).not.toHaveBeenCalled();
    expect(scanner.captureStatusExperimentM2).not.toHaveBeenCalled();
    expect(dependencies.buildOfflineScoringProposal).toHaveBeenCalledWith(
      expect.objectContaining({ measurementNumber: 23, measurementBlocks: 'official-shaped-payload' }),
      expect.objectContaining({ language: 'EN' }),
    );
    expect(scanner.disconnect).toHaveBeenCalledOnce();
    const transcript = writeTranscript.mock.calls[0]?.[0];
    expect(transcript?.rawAoxMeasurementArtifact?.measurementNumber).toBe(23);
    expect(transcript?.offlineScoringProposal?.networkTransmission.value).toBe(false);
    expect(transcript?.measurementBlocksSha256).toBe('a'.repeat(64));
  });
});
