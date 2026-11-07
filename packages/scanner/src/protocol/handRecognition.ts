import { crc16CcittResidual } from './aoxMeasurement.js';
import type { ParsedResponse } from './response.js';

export type HandRecognitionTarget = 'present' | 'removed';
export type HandRecognitionStrategy =
  | { readonly kind: 'sampled'; readonly wifiFirmware: string | undefined; readonly nuvotonFirmware: string | undefined }
  | { readonly kind: 'legacy-thresholds'; readonly darkUpper: number; readonly brightLower: number; readonly brightUpper: number };

export interface LegacyHandRecognitionThresholds {
  readonly darkUpper: number;
  readonly brightLower: number;
  readonly brightUpper: number;
}

export class UnsupportedHandRecognitionFirmwareError extends Error {
  constructor(message = 'Scanner firmware requires configuration-dependent legacy hand-recognition thresholds') {
    super(message); this.name = 'UnsupportedHandRecognitionFirmwareError';
  }
}

export function selectV2HandRecognitionStrategy(
  status: ParsedResponse,
  legacy?: LegacyHandRecognitionThresholds,
): HandRecognitionStrategy {
  if (status.kind !== 'ok') throw new UnsupportedHandRecognitionFirmwareError('A valid V2 status response is required for hand recognition');
  const wifi = stringField(status.json.wifi_firmware);
  const nuvoton = stringField(status.json.nuvoton_firmware);
  const w = parseVersion(wifi); const n = parseVersion(nuvoton);
  if ((w && (w[2]! > 19 || w[1]! > 0 || ![10, 20, 0].includes(w[0]!))) || (n && n[1]! >= 4)) {
    return { kind: 'sampled', wifiFirmware: wifi, nuvotonFirmware: nuvoton };
  }
  if (!legacy) throw new UnsupportedHandRecognitionFirmwareError();
  validateLegacy(legacy);
  return { kind: 'legacy-thresholds', ...legacy };
}

export function handRecognitionCommand(target: HandRecognitionTarget, strategy: HandRecognitionStrategy): { command: 'hand'; params: Record<string, string> } {
  if (strategy.kind === 'legacy-thresholds') return { command: 'hand', params: { du: String(strategy.darkUpper), bl: String(strategy.brightLower), bu: String(strategy.brightUpper) } };
  return target === 'removed'
    ? { command: 'hand', params: { start: '134', count: '10', cycles: '25' } }
    : { command: 'hand', params: { start: '110', count: '13', cycles: '5' } };
}

export function interpretHandRecognitionResponse(response: ParsedResponse, target: HandRecognitionTarget, strategy: HandRecognitionStrategy): boolean {
  if (response.kind !== 'ok') return false;
  if (strategy.kind === 'legacy-thresholds') {
    if (typeof response.json.hand !== 'number') return false;
    const present = response.json.hand === 0;
    return target === 'removed' ? !present : present;
  }
  return parseSampledHandRecognition(response.json.data, target);
}

export interface SampledHandMetrics {
  readonly dark: number;
  readonly near: number;
  readonly middle: number;
  readonly far: number;
}

export function parseSampledHandRecognition(input: unknown, target: HandRecognitionTarget): boolean {
  const metrics = computeSampledHandMetrics(input, target);
  return metrics === null ? false : interpretSampledHandMetrics(metrics, target);
}

/**
 * Diagnostic split of parseSampledHandRecognition(): the averaged channel
 * metrics the APK thresholds are applied to, or null when the sample is
 * malformed (wrong length, bad Base64/CRC). Behavior is unchanged.
 */
export function computeSampledHandMetrics(input: unknown, target: HandRecognitionTarget): SampledHandMetrics | null {
  if (!Array.isArray(input)) return null;
  const removed = target === 'removed';
  const cycles = removed ? 25 : 5;
  const dicts = removed ? HAND_OFF_LEDS : HAND_ON_LEDS;
  const skip = removed ? [4, 5, 9] : [6, 12];
  const parsed: number[][] = [];
  for (let i = cycles + 1; i < input.length; i += cycles + 2) {
    const value = input[i];
    if (typeof value !== 'string') return null;
    const bytes = decode(value);
    if (!bytes || bytes.length < 29 || ((bytes[0]! << 8) | bytes[1]!) !== bytes.length - 2 || crc16CcittResidual(bytes.subarray(2)) !== 0) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    parsed.push(Array.from({ length: 8 }, (_, channel) => view.getUint16(5 + 3 * channel, true)));
  }
  if (parsed.length !== dicts.length) return null;
  const sums = { dark: 0, near: 0, middle: 0, far: 0 };
  const counts = { dark: 0, near: 0, middle: 0, far: 0 };
  parsed.forEach((values, index) => {
    if (skip.includes(index)) return;
    const d = dicts[index]!;
    if (d.dark) { sums.dark += values.reduce((a, b) => a + b, 0); counts.dark += 8; return; }
    for (const channel of d.near) sums.near += values[channel - 1]!;
    for (const channel of d.middle) sums.middle += values[channel - 1]!;
    for (const channel of d.far) sums.far += values[channel - 1]!;
    counts.near += d.near.length; counts.middle += d.middle.length; counts.far += d.far.length;
  });
  const dark = Math.max(1, sums.dark / counts.dark);
  const near = Math.max(1, sums.near / counts.near);
  const middle = Math.max(1, sums.middle / counts.middle);
  const far = Math.max(1, sums.far / counts.far);
  return { dark, near, middle, far };
}

export function interpretSampledHandMetrics(
  metrics: { readonly dark: number; readonly near: number; readonly middle: number; readonly far: number },
  target: HandRecognitionTarget,
): boolean {
  const present = metrics.dark < 3 && metrics.near / metrics.far > 10 && metrics.near / metrics.middle > 2.5;
  return target === 'removed' ? !present : present;
}

type LedMap = { dark: boolean; near: number[]; middle: number[]; far: number[] };
const D = (): LedMap => ({ dark: true, near: [], middle: [], far: [] });
const L = (near: number[], middle: number[], far: number[]): LedMap => ({ dark: false, near, middle, far });
const HAND_ON_LEDS = [D(),L([8],[2,4],[1,3,5,6,7]),L([8],[2,4],[1,3,5,6,7]),L([2,4],[1,3,8],[5,6,7]),L([1,3],[2,4,5],[6,7,8]),L([1,3],[2,4,5],[6,7,8]),D(),L([1,5],[2,3,6],[4,7,8]),L([1,5],[2,3,6],[4,7,8]),L([2,6],[1,5,7],[3,4,8]),L([7],[2,6],[1,3,4,5,8]),L([7],[2,6],[1,3,4,5,8]),D()];
const HAND_OFF_LEDS = [D(),L([4,3],[1,2],[5,6,7,8]),L([1,2],[3,4,5,6],[7,8]),L([5],[1,6],[2,3,4,7,8]),D(),D(),L([3],[1,4],[2,5,6,7,8]),L([1,2],[3,4,5,6],[7,8]),L([5,6],[1,2],[3,4,7,8]),D()];
function decode(value: string): Uint8Array | null { try { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); } catch { return null; } }
function stringField(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined; }
function parseVersion(value: string | undefined): [number, number, number] | null { if (!value) return null; const p=value.split('.'); if(p.length<3) return null; const n=p.slice(0,3).map(Number); return n.every(Number.isFinite) ? n as [number,number,number] : null; }
function validateLegacy(v: LegacyHandRecognitionThresholds): void { if (![v.darkUpper,v.brightLower,v.brightUpper].every(Number.isFinite)) throw new RangeError('Legacy hand-recognition thresholds must be finite'); }
