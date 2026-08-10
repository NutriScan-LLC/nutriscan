import type { ParsedResponse } from './response.js';

// Exact hardware observations from M4-M6 for measurement 21. These are
// comparison fixtures for Experiment M7 only, not production protocol data.
const M4_M6_BASE64 = [
  'AB8BAACYHQCAFS0PgLsFAAQAIAAAAABgAv//AAAAADTZ',
  'AB8BAADE3hbWT2KunRwkhDGlIorTUzYp+mXOXOq+fTsw',
  'AB8CAACmclbU1G4wLk6frUkzE9eFLJSYsS8OobHvlzJo',
] as const;

export interface M7DecodedBlockObservation {
  readonly arrayIndex: number;
  readonly base64: string;
  readonly byteLength: number;
  readonly hex: string;
  readonly bigEndianLength: number | undefined;
  readonly littleEndianInternalIndex: number | undefined;
  readonly crcResidual: number;
  readonly matchesSavedIndividualBlock: 'M4' | 'M5' | 'M6' | null;
}

export type M7FlashAnalysis =
  | {
      readonly kind: 'analyzed';
      readonly returnedElementCount: number;
      readonly blocks: readonly M7DecodedBlockObservation[];
    }
  | { readonly kind: 'unavailable'; readonly reason: string };

export type M8FlashAnalysis = M7FlashAnalysis;
export type M9FlashAnalysis = M7FlashAnalysis;
export type M10FlashAnalysis = M7FlashAnalysis;
export type M11FlashAnalysis = M7FlashAnalysis;
export type M12FlashAnalysis = M7FlashAnalysis;
export type M13FlashAnalysis = M7FlashAnalysis;
export type M14FlashAnalysis = M7FlashAnalysis;

/**
 * UNVERIFIED — Experiment M7 diagnostic analysis only.
 *
 * Decodes every string in a successful response's `data` array, preserves
 * exact bytes as hex, reports the observed framing numbers and CRC
 * residual, and compares against saved M4-M6 blocks. It assigns no payload
 * semantics and performs no normalization.
 */
export function analyzeM7FlashResponse(response: ParsedResponse): M7FlashAnalysis {
  return analyzeExperimentalFlashResponse(response);
}

/** UNVERIFIED — Experiment M8 uses the same per-element analysis for an oversized requested range. */
export function analyzeM8FlashResponse(response: ParsedResponse): M8FlashAnalysis {
  return analyzeExperimentalFlashResponse(response);
}

/** UNVERIFIED — Experiment M9 uses the same per-element analysis for the next bounded range. */
export function analyzeM9FlashResponse(response: ParsedResponse): M9FlashAnalysis {
  return analyzeExperimentalFlashResponse(response);
}

/** UNVERIFIED — Experiment M10 uses the same byte-preserving per-element analysis. */
export function analyzeM10FlashResponse(response: ParsedResponse): M10FlashAnalysis {
  return analyzeExperimentalFlashResponse(response);
}

/** UNVERIFIED — Experiment M11 uses the same byte-preserving per-element analysis. */
export function analyzeM11FlashResponse(response: ParsedResponse): M11FlashAnalysis {
  return analyzeExperimentalFlashResponse(response);
}

/** UNVERIFIED — Experiment M12 uses the same byte-preserving per-element analysis. */
export function analyzeM12FlashResponse(response: ParsedResponse): M12FlashAnalysis {
  return analyzeExperimentalFlashResponse(response);
}

/** UNVERIFIED — Experiment M13 uses the same byte-preserving per-element analysis. */
export function analyzeM13FlashResponse(response: ParsedResponse): M13FlashAnalysis {
  return analyzeExperimentalFlashResponse(response);
}

/** UNVERIFIED — Experiment M14 preserves even empty, error, or unusual response shapes. */
export function analyzeM14FlashResponse(response: ParsedResponse): M14FlashAnalysis {
  return analyzeExperimentalFlashResponse(response);
}

function analyzeExperimentalFlashResponse(response: ParsedResponse): M7FlashAnalysis {
  if (response.kind !== 'ok') {
    return { kind: 'unavailable', reason: `ParsedResponse kind was ${response.kind}, not ok` };
  }

  const data = response.json.data;
  if (!Array.isArray(data) || !data.every((value): value is string => typeof value === 'string')) {
    return { kind: 'unavailable', reason: 'Response data was not an array of Base64 strings' };
  }

  try {
    return {
      kind: 'analyzed',
      returnedElementCount: data.length,
      blocks: data.map((base64, arrayIndex) => analyzeBlock(base64, arrayIndex)),
    };
  } catch (err) {
    return {
      kind: 'unavailable',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

function analyzeBlock(base64: string, arrayIndex: number): M7DecodedBlockObservation {
  const bytes = decodeBase64(base64);
  return {
    arrayIndex,
    base64,
    byteLength: bytes.length,
    hex: Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(' '),
    bigEndianLength: bytes.length >= 2 ? (bytes[0]! << 8) | bytes[1]! : undefined,
    littleEndianInternalIndex: bytes.length >= 4 ? bytes[2]! | (bytes[3]! << 8) : undefined,
    crcResidual: crc16CcittResidual(bytes.subarray(2)),
    matchesSavedIndividualBlock: matchSavedBlock(bytes),
  };
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function matchSavedBlock(bytes: Uint8Array): 'M4' | 'M5' | 'M6' | null {
  for (let index = 0; index < M4_M6_BASE64.length; index++) {
    if (bytesEqual(bytes, decodeBase64(M4_M6_BASE64[index]!))) {
      return (['M4', 'M5', 'M6'] as const)[index]!;
    }
  }
  return null;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function crc16CcittResidual(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}
