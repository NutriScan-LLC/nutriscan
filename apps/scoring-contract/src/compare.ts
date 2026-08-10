import { createHash } from 'node:crypto';

export interface ScoringContractSnapshot {
  readonly endpoint: string;
  readonly method: string;
  readonly query: Readonly<Record<string, string>>;
  readonly multipart: {
    readonly fieldName: string;
    readonly filename: string;
    readonly contentType: string;
    readonly boundary?: string;
  };
  readonly measureJson: {
    readonly Serial: string;
    readonly MeasurementBlocks?: string;
    readonly MeasurementBlocksLength?: number;
    readonly MeasurementBlocksSha256?: string;
    readonly UserID: string;
    readonly lang: string;
    readonly AdditionalData: string | Readonly<Record<string, unknown>>;
  };
  readonly headers?: Readonly<Record<string, string>>;
  readonly session?: {
    readonly sendsCookies?: boolean;
    readonly sendsAuthorization?: boolean;
  };
}

export interface ContractDifference {
  readonly path: string;
  readonly official: unknown;
  readonly reconstructed: unknown;
}

export interface ContractComparison {
  readonly matches: boolean;
  readonly differences: readonly ContractDifference[];
  readonly officialMeasurementBlocks: MeasurementBlocksIdentity;
  readonly reconstructedMeasurementBlocks: MeasurementBlocksIdentity;
}

export interface MeasurementBlocksIdentity { readonly length: number | null; readonly sha256: string | null }

const SAFE_HEADERS = ['accept', 'content-type', 'origin', 'referer', 'user-agent'] as const;

/** Offline structural comparison. It performs no network access and never prints payload contents. */
export function compareScoringContracts(
  official: ScoringContractSnapshot,
  reconstructed: ScoringContractSnapshot,
): ContractComparison {
  const differences: ContractDifference[] = [];
  const compare = (path: string, left: unknown, right: unknown) => {
    if (JSON.stringify(left) !== JSON.stringify(right)) differences.push({ path, official: left, reconstructed: right });
  };
  compare('endpoint', official.endpoint, reconstructed.endpoint);
  compare('method', official.method.toUpperCase(), reconstructed.method.toUpperCase());
  compare('query', sortedRecord(official.query), sortedRecord(reconstructed.query));
  compare('multipart.fieldName', official.multipart.fieldName, reconstructed.multipart.fieldName);
  compare('multipart.filename', official.multipart.filename, reconstructed.multipart.filename);
  compare('multipart.contentType', official.multipart.contentType.toLowerCase(), reconstructed.multipart.contentType.toLowerCase());
  compare('measureJson.Serial', official.measureJson.Serial, reconstructed.measureJson.Serial);
  compare('measureJson.UserID', official.measureJson.UserID, reconstructed.measureJson.UserID);
  compare('measureJson.lang', official.measureJson.lang, reconstructed.measureJson.lang);
  compare('measureJson.AdditionalData', normalizeAdditionalData(official.measureJson.AdditionalData), normalizeAdditionalData(reconstructed.measureJson.AdditionalData));
  const officialBlocks = measurementBlocksIdentity(official.measureJson);
  const reconstructedBlocks = measurementBlocksIdentity(reconstructed.measureJson);
  compare('measureJson.MeasurementBlocks.length', officialBlocks.length, reconstructedBlocks.length);
  compare('measureJson.MeasurementBlocks.sha256', officialBlocks.sha256, reconstructedBlocks.sha256);
  for (const name of SAFE_HEADERS) compare(`headers.${name}`, header(official.headers, name), header(reconstructed.headers, name));
  compare('session.sendsCookies', official.session?.sendsCookies ?? false, reconstructed.session?.sendsCookies ?? false);
  compare('session.sendsAuthorization', official.session?.sendsAuthorization ?? false, reconstructed.session?.sendsAuthorization ?? false);
  return { matches: differences.length === 0, differences, officialMeasurementBlocks: officialBlocks, reconstructedMeasurementBlocks: reconstructedBlocks };
}

export function measurementBlocksIdentity(measureJson: ScoringContractSnapshot['measureJson']): MeasurementBlocksIdentity {
  if (typeof measureJson.MeasurementBlocks === 'string') {
    return {
      length: measureJson.MeasurementBlocks.length,
      sha256: createHash('sha256').update(measureJson.MeasurementBlocks, 'utf8').digest('hex'),
    };
  }
  return {
    length: measureJson.MeasurementBlocksLength ?? null,
    sha256: measureJson.MeasurementBlocksSha256?.toLowerCase() ?? null,
  };
}

function normalizeAdditionalData(value: ScoringContractSnapshot['measureJson']['AdditionalData']): unknown {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  return sortJson(parsed);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, sortJson(entry)]));
  }
  return value;
}

function sortedRecord(value: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function header(headers: Readonly<Record<string, string>> | undefined, target: string): string | null {
  const match = Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === target);
  if (match === undefined) return null;
  if (target === 'content-type') return match[1].replace(/boundary=[^;]+/i, 'boundary=<generated>');
  return match[1];
}
