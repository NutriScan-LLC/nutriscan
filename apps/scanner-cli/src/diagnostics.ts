import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type {
  M7FlashAnalysis,
  M9FlashAnalysis,
  M10FlashAnalysis,
  M11FlashAnalysis,
  M12FlashAnalysis,
  M13FlashAnalysis,
  M14FlashAnalysis,
  ExperimentalAoxMeasurementArtifact,
  ExperimentalLiveAoxArtifact,
  ExperimentalLiveAoxOptions,
  AoxMeasurementStart,
  DownloadAoxMeasurementOptions,
  ParsedResponse,
  RawAoxMeasurementArtifact,
  RawByteDirection,
  ScannerIdentity,
  TransportLogger,
} from '@nutriscan/scanner';
import { toHex } from '@nutriscan/scanner';
import type {
  BuildOfflineBioZoomScoringProposalOptions,
  OfflineBioZoomScoringProposal,
} from '@nutriscan/scoring';

export type DiagnosticAction = 'identify' | 'status' | 'M7' | 'M9' | 'M10' | 'M11' | 'M12' | 'M13' | 'M14' | 'M15' | 'DOWNLOAD21' | 'OFFLINE-SCORING';

export interface DiagnosticRequest {
  action: DiagnosticAction;
  port: string;
  language?: string;
}

export interface DiagnosticScanner {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  identify(): Promise<ScannerIdentity>;
  captureStatusExperimentM2(): Promise<ParsedResponse>;
  readFirstThreeFlashBlocksExperimentM7(measurementNumber: number): Promise<ParsedResponse>;
  readSecondBoundedFlashRangeExperimentM9(measurementNumber: number): Promise<ParsedResponse>;
  readThirdBoundedFlashRangeExperimentM10(measurementNumber: number): Promise<ParsedResponse>;
  readFourthBoundedFlashRangeExperimentM11(measurementNumber: number): Promise<ParsedResponse>;
  readFifthBoundedFlashRangeExperimentM12(measurementNumber: number): Promise<ParsedResponse>;
  readAoxBoundaryLastBlockExperimentM13(measurementNumber: number): Promise<ParsedResponse>;
  readAoxBoundaryBeyondEndExperimentM14(measurementNumber: number): Promise<ParsedResponse>;
  downloadCompletedAoxMeasurement21Experiment(): Promise<ExperimentalAoxMeasurementArtifact>;
  runNonDestructiveLiveAoxExperimentM15(options?: ExperimentalLiveAoxOptions): Promise<ExperimentalLiveAoxArtifact>;
  startAoxMeasurement(): Promise<AoxMeasurementStart>;
  downloadAoxMeasurement(measurementNumber: number, options?: DownloadAoxMeasurementOptions): Promise<RawAoxMeasurementArtifact>;
}

export type CreateDiagnosticScanner = (port: string, logger: TransportLogger) => DiagnosticScanner;

export interface RawTranscriptEntry {
  timestamp: string;
  direction: RawByteDirection;
  hex: string;
  bytes: number[];
}

export interface DiagnosticTranscript {
  schemaVersion: 1;
  experimental: true;
  action: DiagnosticAction;
  port: string;
  startedAt: string;
  completedAt: string;
  scannerSerial: string | null;
  protocolVersion: string | null;
  raw: RawTranscriptEntry[];
  identityCapturedAt: string | null;
  responseCapturedAt: string | null;
  identity: unknown | null;
  response: unknown | null;
  analysis: M7FlashAnalysis | M9FlashAnalysis | M10FlashAnalysis | M11FlashAnalysis | M12FlashAnalysis | M13FlashAnalysis | M14FlashAnalysis | null;
  measurementArtifact?: ExperimentalAoxMeasurementArtifact | null;
  liveAcquisitionArtifact?: ExperimentalLiveAoxArtifact | null;
  rawAoxMeasurementArtifact?: RawAoxMeasurementArtifact | null;
  offlineScoringProposal?: OfflineBioZoomScoringProposal | null;
  measurementBlocksSha256?: string | null;
  error: unknown | null;
}

export interface DiagnosticIo {
  log(message: string): void;
}

export interface DiagnosticDependencies {
  createScanner: CreateDiagnosticScanner;
  analyzeM7(response: ParsedResponse): M7FlashAnalysis;
  analyzeM9(response: ParsedResponse): M9FlashAnalysis;
  analyzeM10(response: ParsedResponse): M10FlashAnalysis;
  analyzeM11(response: ParsedResponse): M11FlashAnalysis;
  analyzeM12(response: ParsedResponse): M12FlashAnalysis;
  analyzeM13(response: ParsedResponse): M13FlashAnalysis;
  analyzeM14(response: ParsedResponse): M14FlashAnalysis;
  writeTranscript(transcript: DiagnosticTranscript): Promise<string>;
  waitForHandReady(): Promise<void>;
  buildOfflineScoringProposal(
    artifact: RawAoxMeasurementArtifact,
    options: BuildOfflineBioZoomScoringProposalOptions,
  ): OfflineBioZoomScoringProposal;
  sleep(milliseconds: number): Promise<void>;
  now(): Date;
}

export async function executeDiagnostic(
  request: DiagnosticRequest,
  dependencies: DiagnosticDependencies,
  io: DiagnosticIo,
): Promise<{ transcript: DiagnosticTranscript; file: string }> {
  const startedAt = dependencies.now().toISOString();
  const raw: RawTranscriptEntry[] = [];
  let identity: ScannerIdentity | null = null;
  let response: ParsedResponse | null = null;
  let identityCapturedAt: string | null = null;
  let responseCapturedAt: string | null = null;
  let analysis: M7FlashAnalysis | M9FlashAnalysis | M10FlashAnalysis | M11FlashAnalysis | M12FlashAnalysis | M13FlashAnalysis | M14FlashAnalysis | null = null;
  let failure: unknown = null;
  let measurementArtifact: ExperimentalAoxMeasurementArtifact | null = null;
  let liveAcquisitionArtifact: ExperimentalLiveAoxArtifact | null = null;
  let rawAoxMeasurementArtifact: RawAoxMeasurementArtifact | null = null;
  let offlineScoringProposal: OfflineBioZoomScoringProposal | null = null;
  let measurementBlocksSha256: string | null = null;
  let scanner: DiagnosticScanner | null = null;

  const logger: TransportLogger = {
    onRawBytes(direction, bytes) {
      const entry = {
        timestamp: dependencies.now().toISOString(),
        direction,
        hex: toHex(bytes),
        bytes: Array.from(bytes),
      } satisfies RawTranscriptEntry;
      raw.push(entry);
      io.log(`[${entry.timestamp}] ${direction === 'write' ? 'TX' : 'RX'} ${entry.hex}`);
    },
  };

  io.log(`[${startedAt}] Experimental diagnostic ${request.action} beginning on ${request.port}`);

  try {
    scanner = dependencies.createScanner(request.port, logger);
    await scanner.connect();
    identity = await scanner.identify();
    identityCapturedAt = dependencies.now().toISOString();
    io.log(`[${identityCapturedAt}] Identity:\n${stringifyDiagnostic(identity)}`);
    io.log(`Scanner serial: ${identity.serial ?? 'unknown'}`);
    io.log(`Protocol version: ${identity.protocolVersion}`);

    if (request.action === 'status') {
      response = await scanner.captureStatusExperimentM2();
      responseCapturedAt = dependencies.now().toISOString();
      io.log(`[${responseCapturedAt}] Status ParsedResponse:\n${stringifyDiagnostic(response)}`);
    } else if (request.action === 'M7') {
      response = await scanner.readFirstThreeFlashBlocksExperimentM7(21);
      responseCapturedAt = dependencies.now().toISOString();
      analysis = dependencies.analyzeM7(response);
      io.log(`[${responseCapturedAt}] M7 ParsedResponse:\n${stringifyDiagnostic(response)}`);
      io.log(`M7 decoded analysis:\n${stringifyDiagnostic(analysis)}`);
    } else if (request.action === 'M9') {
      response = await scanner.readSecondBoundedFlashRangeExperimentM9(21);
      responseCapturedAt = dependencies.now().toISOString();
      analysis = dependencies.analyzeM9(response);
      io.log(`[${responseCapturedAt}] M9 ParsedResponse:\n${stringifyDiagnostic(response)}`);
      io.log(`M9 decoded analysis:\n${stringifyDiagnostic(analysis)}`);
    } else if (request.action === 'M10') {
      response = await scanner.readThirdBoundedFlashRangeExperimentM10(21);
      responseCapturedAt = dependencies.now().toISOString();
      analysis = dependencies.analyzeM10(response);
      io.log(`[${responseCapturedAt}] M10 ParsedResponse:\n${stringifyDiagnostic(response)}`);
      io.log(`M10 decoded analysis:\n${stringifyDiagnostic(analysis)}`);
    } else if (request.action === 'M11') {
      response = await scanner.readFourthBoundedFlashRangeExperimentM11(21);
      responseCapturedAt = dependencies.now().toISOString();
      analysis = dependencies.analyzeM11(response);
      io.log(`[${responseCapturedAt}] M11 ParsedResponse:\n${stringifyDiagnostic(response)}`);
      io.log(`M11 decoded analysis:\n${stringifyDiagnostic(analysis)}`);
    } else if (request.action === 'M12') {
      response = await scanner.readFifthBoundedFlashRangeExperimentM12(21);
      responseCapturedAt = dependencies.now().toISOString();
      analysis = dependencies.analyzeM12(response);
      io.log(`[${responseCapturedAt}] M12 ParsedResponse:\n${stringifyDiagnostic(response)}`);
      io.log(`M12 decoded analysis:\n${stringifyDiagnostic(analysis)}`);
    } else if (request.action === 'M13') {
      response = await scanner.readAoxBoundaryLastBlockExperimentM13(21);
      responseCapturedAt = dependencies.now().toISOString();
      analysis = dependencies.analyzeM13(response);
      io.log(`[${responseCapturedAt}] M13 ParsedResponse:\n${stringifyDiagnostic(response)}`);
      io.log(`M13 decoded analysis:\n${stringifyDiagnostic(analysis)}`);
    } else if (request.action === 'M14') {
      response = await scanner.readAoxBoundaryBeyondEndExperimentM14(21);
      responseCapturedAt = dependencies.now().toISOString();
      analysis = dependencies.analyzeM14(response);
      io.log(`[${responseCapturedAt}] M14 ParsedResponse:\n${stringifyDiagnostic(response)}`);
      io.log(`M14 decoded analysis:\n${stringifyDiagnostic(analysis)}`);
    } else if (request.action === 'M15') {
      liveAcquisitionArtifact = await scanner.runNonDestructiveLiveAoxExperimentM15({
        now: dependencies.now,
        waitForHandReady: dependencies.waitForHandReady,
        onEvent: (event) => io.log(`[${event.timestamp}] M15 ${event.kind}:\n${stringifyDiagnostic(event.detail)}`),
      });
      responseCapturedAt = dependencies.now().toISOString();
      measurementBlocksSha256 = createHash('sha256')
        .update(liveAcquisitionArtifact.acquisition.measurementBlocks, 'utf8')
        .digest('hex');
      io.log(`[${responseCapturedAt}] M15 acquisition complete=${liveAcquisitionArtifact.acquisition.complete}, blocks=${liveAcquisitionArtifact.acquisition.blocks.length}, missing=${liveAcquisitionArtifact.acquisition.missingLogicalIndexes.length}, anomalies=${liveAcquisitionArtifact.acquisition.anomalies.length}, retries=${liveAcquisitionArtifact.acquisition.retryRounds}`);
      io.log(`M15 MeasurementBlocks SHA-256: ${measurementBlocksSha256}`);
    } else if (request.action === 'DOWNLOAD21') {
      measurementArtifact = await scanner.downloadCompletedAoxMeasurement21Experiment();
      responseCapturedAt = dependencies.now().toISOString();
      io.log(`[${responseCapturedAt}] Measurement 21 download complete=${measurementArtifact.complete}, blocks=${measurementArtifact.blocks.length}, missing=${measurementArtifact.missingLogicalIndexes.length}, anomalies=${measurementArtifact.anomalies.length}, reads=${measurementArtifact.reads.length}`);
    } else if (request.action === 'OFFLINE-SCORING') {
      await dependencies.waitForHandReady();
      const acknowledgment = await scanner.startAoxMeasurement();
      const acknowledgedAt = new Date(acknowledgment.acknowledgedAt);
      io.log(`[${acknowledgedAt.toISOString()}] Production AOX measurement acknowledged: measurement_nr=${acknowledgment.measurementNumber}`);

      rawAoxMeasurementArtifact = await scanner.downloadAoxMeasurement(acknowledgment.measurementNumber, {
        range: 150,
        maxMissingRangeRetries: 4,
        onProgress: (progress, read) => {
          io.log(`[${dependencies.now().toISOString()}] AOX download: valid=${progress.summary.validBlockCount}/${progress.profile.logicalBlockCount}, missing=${progress.missingLogicalIndexes.length}, lastRange=${read.start}+${read.range}`);
        },
      });
      responseCapturedAt = dependencies.now().toISOString();
      if (!rawAoxMeasurementArtifact.summary.complete || rawAoxMeasurementArtifact.failure !== null) {
        throw new Error(`AOX acquisition incomplete: ${rawAoxMeasurementArtifact.summary.validBlockCount}/${rawAoxMeasurementArtifact.profile.logicalBlockCount} valid blocks`);
      }
      offlineScoringProposal = dependencies.buildOfflineScoringProposal(rawAoxMeasurementArtifact, {
        language: request.language!,
        now: dependencies.now,
      });
      measurementBlocksSha256 = offlineScoringProposal.acquisition.measurementBlocksSha256.value;
      io.log(`[${responseCapturedAt}] Offline scoring artifact complete (nothing transmitted):\n${stringifyDiagnostic({
        scannerSerial: offlineScoringProposal.acquisition.scannerSerial,
        measurementNumber: offlineScoringProposal.acquisition.measurementNumber,
        blockCount: offlineScoringProposal.acquisition.blockCount,
        measurementBlocksLength: offlineScoringProposal.acquisition.measurementBlocksLength,
        measurementBlocksSha256: offlineScoringProposal.acquisition.measurementBlocksSha256,
        preRequest: offlineScoringProposal.preRequest,
        measureRequest: {
          ...offlineScoringProposal.measureRequest,
          measureJson: {
            ...offlineScoringProposal.measureRequest.measureJson,
            value: {
              ...offlineScoringProposal.measureRequest.measureJson.value,
              MeasurementBlocks: `[saved in transcript; ${offlineScoringProposal.acquisition.measurementBlocksLength.value} characters]`,
            },
          },
        },
        fieldEvidence: offlineScoringProposal.fieldEvidence,
        omittedOfficialFields: offlineScoringProposal.omittedOfficialFields,
        networkTransmission: offlineScoringProposal.networkTransmission,
      })}`);
    }
  } catch (err) {
    failure = err;
    io.log(`Diagnostic error (unchanged):\n${stringifyDiagnostic(err)}`);
  } finally {
    if (scanner !== null) {
      try {
        await scanner.disconnect();
      } catch (disconnectError) {
        if (failure === null) failure = disconnectError;
        io.log(`Disconnect error (unchanged):\n${stringifyDiagnostic(disconnectError)}`);
      }
    }
  }

  const transcript: DiagnosticTranscript = {
    schemaVersion: 1,
    experimental: true,
    action: request.action,
    port: request.port,
    startedAt,
    completedAt: dependencies.now().toISOString(),
    scannerSerial: identity?.serial ?? null,
    protocolVersion: identity?.protocolVersion ?? null,
    raw,
    identityCapturedAt,
    responseCapturedAt,
    identity: identity === null ? null : toDiagnosticJson(identity),
    response: response === null ? null : toDiagnosticJson(response),
    analysis,
    measurementArtifact,
    liveAcquisitionArtifact,
    rawAoxMeasurementArtifact,
    offlineScoringProposal,
    measurementBlocksSha256,
    error: failure === null ? null : toDiagnosticJson(failure),
  };
  const file = await dependencies.writeTranscript(transcript);
  io.log(`Transcript: ${file}`);

  if (failure !== null) throw failure;
  return { transcript, file };
}

export function createFileTranscriptWriter(directory = path.resolve('diagnostics')) {
  return async (transcript: DiagnosticTranscript): Promise<string> => {
    await mkdir(directory, { recursive: true });
    const timestamp = transcript.startedAt.replaceAll(':', '-');
    const filename = `${timestamp}-${transcript.action.toLowerCase()}.json`;
    const destination = path.join(directory, filename);
    await writeFile(destination, `${JSON.stringify(transcript, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    return destination;
  };
}

export function stringifyDiagnostic(value: unknown): string {
  return JSON.stringify(toDiagnosticJson(value), null, 2);
}

export function toDiagnosticJson(value: unknown): unknown {
  if (value instanceof Uint8Array) return { hex: toHex(value), bytes: Array.from(value) };
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (Array.isArray(value)) return value.map(toDiagnosticJson);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toDiagnosticJson(entry)]));
  }
  return value;
}
