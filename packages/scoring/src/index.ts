import { createHash, randomUUID } from 'node:crypto';
import type { RawAoxMeasurementArtifact } from '@nutriscan/scanner';

export * from './preRequestDiagnostic.js';
export * from './measurementSubmissionDiagnostic.js';
export * from './pairedScoringDiagnostic.js';
export * from './quickAox.js';
export * from './quickAoxContract.js';

export type EvidenceClassification =
  | 'hardware confirmed'
  | 'APK confirmed'
  | 'runtime confirmed'
  | 'still unverified';

export interface EvidenceField<T> {
  readonly value: T;
  readonly classification: EvidenceClassification;
  readonly basis: string;
}

export interface BioZoomMeasureJson {
  readonly Serial: string;
  readonly MeasurementBlocks: string;
  readonly UserID: 'ffffffffffffffffffffffffffffffff';
  readonly lang: string;
  readonly AdditionalData: string;
}

export interface OfflineBioZoomScoringProposal {
  readonly schemaVersion: 1;
  readonly offlineOnly: true;
  readonly createdAt: string;
  readonly acquisition: {
    readonly scannerSerial: EvidenceField<string>;
    readonly measurementNumber: EvidenceField<number>;
    readonly blockCount: EvidenceField<number>;
    readonly measurementBlocksLength: EvidenceField<number>;
    readonly measurementBlocksSha256: EvidenceField<string>;
  };
  readonly preRequest: {
    readonly method: EvidenceField<'GET'>;
    readonly url: EvidenceField<string>;
    readonly configuredBaseUrl: EvidenceField<string>;
    readonly response: EvidenceField<null>;
  };
  readonly measureRequest: {
    readonly method: EvidenceField<'POST'>;
    readonly urlTemplate: EvidenceField<string>;
    readonly actualRecommendedServer: EvidenceField<null>;
    readonly contentType: EvidenceField<string>;
    readonly multipartFieldName: EvidenceField<'measure_json'>;
    readonly filename: EvidenceField<'measure.json'>;
    readonly fileContentType: EvidenceField<'application/json'>;
    readonly measureJson: EvidenceField<BioZoomMeasureJson>;
  };
  readonly fieldEvidence: Readonly<Record<string, EvidenceField<unknown>>>;
  readonly omittedOfficialFields: Readonly<Record<string, EvidenceField<null>>>;
  readonly networkTransmission: EvidenceField<false>;
}

export interface BuildOfflineBioZoomScoringProposalOptions {
  readonly language: string;
  readonly now?: () => Date;
  readonly uuid?: () => string;
  /** APK 0.50.107 bundled current configuration; callers may supply a reviewed replacement. */
  readonly configuredVwsBaseUrl?: string;
}

/**
 * Pure offline conversion from a complete scanner artifact to the proposed
 * official-app-compatible request. This package intentionally exports no HTTP
 * client and performs no network access.
 */
export function buildOfflineBioZoomScoringProposal(
  artifact: RawAoxMeasurementArtifact,
  options: BuildOfflineBioZoomScoringProposalOptions,
): OfflineBioZoomScoringProposal {
  if (!artifact.summary.complete || artifact.failure !== null) {
    throw new Error('A complete, valid RawAoxMeasurementArtifact is required');
  }
  if (artifact.scannerSerial === undefined || artifact.scannerSerial.length === 0) {
    throw new Error('RawAoxMeasurementArtifact must include the scanner serial');
  }
  if (!/^[A-Za-z]{2}$/.test(options.language)) {
    throw new RangeError('language must be the exact two-letter value proposed for measure_json.lang');
  }
  if (artifact.blocks.length !== artifact.profile.logicalBlockCount) {
    throw new Error('RawAoxMeasurementArtifact block count does not match its profile');
  }

  const now = options.now ?? (() => new Date());
  const uuid = (options.uuid ?? randomUUID)();
  const configuredVwsBaseUrl = options.configuredVwsBaseUrl ?? 'https://de2.biozoom.net';
  const measurementBlocksSha256 = createHash('sha256')
    .update(artifact.measurementBlocks, 'utf8')
    .digest('hex');
  const additionalData = {
    model: modelForSerial(artifact.scannerSerial),
    veggie_04: true,
    uuid,
    measurement_type: 'aox',
  } as const;
  const measureJson: BioZoomMeasureJson = {
    Serial: artifact.scannerSerial,
    MeasurementBlocks: artifact.measurementBlocks,
    UserID: 'ffffffffffffffffffffffffffffffff',
    lang: options.language,
    AdditionalData: JSON.stringify(additionalData),
  };
  const preRequestUrl = `${configuredVwsBaseUrl}/pre-request/?serial_id=${encodeURIComponent(artifact.scannerSerial)}&measure_type=0`;

  return {
    schemaVersion: 1,
    offlineOnly: true,
    createdAt: now().toISOString(),
    acquisition: {
      scannerSerial: field(artifact.scannerSerial, 'hardware confirmed', 'BioZoomScanner.identify() and completed acquisition artifact'),
      measurementNumber: field(artifact.measurementNumber, 'hardware confirmed', 'measure?type=aox acknowledgment used by downloadAoxMeasurement()'),
      blockCount: field(artifact.blocks.length, 'hardware confirmed', '5,773 validated scanner flash blocks'),
      measurementBlocksLength: field(artifact.measurementBlocks.length, 'runtime confirmed', 'Length calculated locally from exact reconstructed MeasurementBlocks'),
      measurementBlocksSha256: field(measurementBlocksSha256, 'runtime confirmed', 'SHA-256 calculated locally over UTF-8 MeasurementBlocks'),
    },
    preRequest: {
      method: field('GET', 'APK confirmed', 'VitalityCheck 0.50.107 quick-AOX path'),
      url: field(preRequestUrl, 'APK confirmed', 'Bundled calcURLs plus APK-confirmed path/query construction; no request sent'),
      configuredBaseUrl: field(configuredVwsBaseUrl, 'APK confirmed', 'VitalityCheck 0.50.107 bundled default-design calcURLs'),
      response: field(null, 'still unverified', 'Offline diagnostic does not contact the pre-request endpoint'),
    },
    measureRequest: {
      method: field('POST', 'APK confirmed', 'VitalityCheck 0.50.107 VWS measurement path'),
      urlTemplate: field(`<recommended_server>/measure/?serial_id=${encodeURIComponent(artifact.scannerSerial)}&measure_type=0`, 'APK confirmed', 'Actual host comes only from a pre-request response'),
      actualRecommendedServer: field(null, 'still unverified', 'No pre-request was sent'),
      contentType: field('multipart/form-data; boundary=<runtime-generated>', 'APK confirmed', 'Official app lets WebView generate the multipart boundary'),
      multipartFieldName: field('measure_json', 'APK confirmed', 'VitalityCheck 0.50.107 FormData construction'),
      filename: field('measure.json', 'APK confirmed', 'VitalityCheck 0.50.107 File construction'),
      fileContentType: field('application/json', 'APK confirmed', 'VitalityCheck 0.50.107 Blob construction'),
      measureJson: field(measureJson, 'runtime confirmed', 'Locally constructed from hardware artifact using APK-confirmed schema; not transmitted'),
    },
    fieldEvidence: {
      'measure_json.Serial': field(measureJson.Serial, 'hardware confirmed', 'Connected scanner identity'),
      'measure_json.MeasurementBlocks': field('[preserved in measureJson]', 'hardware confirmed', 'Exact ordered original Base64 blocks reconstructed and validated'),
      'measure_json.UserID': field(measureJson.UserID, 'APK confirmed', 'Fixed VitalityCheck 0.50.107 sentinel'),
      'measure_json.lang': field(measureJson.lang, 'runtime confirmed', 'Explicit diagnostic CLI input'),
      'measure_json.AdditionalData': field(measureJson.AdditionalData, 'runtime confirmed', 'Locally serialized APK-confirmed minimum fields'),
      'AdditionalData.model': field(additionalData.model, 'APK confirmed', 'APK serial-prefix mapping for 2N scanner'),
      'AdditionalData.veggie_04': field(true, 'APK confirmed', 'APK metadata generation for 2N scanner'),
      'AdditionalData.uuid': field(uuid, 'runtime confirmed', 'Locally generated UUID v4 for proposed request'),
      'AdditionalData.measurement_type': field('aox', 'APK confirmed', 'APK quick-AOX VWS metadata'),
    },
    omittedOfficialFields: {
      'AdditionalData.status_before': field(null, 'still unverified', 'Production acquisition API does not collect an official-app status snapshot'),
      'AdditionalData.status_after': field(null, 'still unverified', 'Production acquisition API does not collect an official-app status snapshot'),
      'AdditionalData.app_version': field(null, 'still unverified', 'NutriScan is not impersonating the official app version'),
      'AdditionalData.config': field(null, 'still unverified', 'Scanner-specific official application design was not runtime-captured'),
      'AdditionalData.localLog': field(null, 'still unverified', 'Official app-local log is unavailable and not invented'),
      'AdditionalData.aox_subtype': field(null, 'still unverified', 'Runtime official pipeline value was not captured'),
    },
    networkTransmission: field(false, 'runtime confirmed', 'Builder has no network transport and no HTTP request was performed'),
  };
}

function field<T>(value: T, classification: EvidenceClassification, basis: string): EvidenceField<T> {
  return { value, classification, basis };
}

function modelForSerial(serial: string): 'MRSRRS_SCN06' {
  if (!serial.startsWith('2E') && !serial.startsWith('2N')) {
    throw new Error(`Offline scoring proposal currently supports only APK-confirmed 2E/2N SCN06 mapping; received ${serial}`);
  }
  return 'MRSRRS_SCN06';
}

/** Proposed future boundary; intentionally no implementation or transport yet. */
export interface BioZoomScoringClient {
  prepare(artifact: RawAoxMeasurementArtifact, options: BuildOfflineBioZoomScoringProposalOptions): OfflineBioZoomScoringProposal;
  score(request: OfflineBioZoomScoringProposal): Promise<ParsedAoxScoringResult>;
}

export interface ParsedAoxScoringResult {
  readonly raw: unknown;
  readonly aox?: number;
  readonly aoxQ?: number;
  readonly quality?: unknown;
  readonly errors?: unknown;
}
