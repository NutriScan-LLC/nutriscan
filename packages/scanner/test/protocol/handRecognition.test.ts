import { describe, expect, it } from 'vitest';
import { handRecognitionCommand, interpretHandRecognitionResponse, interpretSampledHandMetrics, selectV2HandRecognitionStrategy, UnsupportedHandRecognitionFirmwareError } from '../../src/protocol/handRecognition.js';
import type { ParsedResponse } from '../../src/protocol/response.js';

const ok = (json: Record<string, unknown>): ParsedResponse => ({ kind: 'ok', json, rawBytes: new Uint8Array(), strippedLeadingByteCount: 0, text: '{}', command: 'status', serial: '2N', callIndex: 'x' });

describe('V2 hand recognition strategy', () => {
  it('selects sampled commands from safely parsed Wi-Fi or Nuvoton firmware', () => {
    const wifi = selectV2HandRecognitionStrategy(ok({ wifi_firmware: '10.0.20' }));
    expect(handRecognitionCommand('present', wifi).params).toEqual({ start: '110', count: '13', cycles: '5' });
    const nuvoton = selectV2HandRecognitionStrategy(ok({ wifi_firmware: '10.0.1', nuvoton_firmware: '1.4.0' }));
    expect(handRecognitionCommand('removed', nuvoton).params).toEqual({ start: '134', count: '10', cycles: '25' });
  });

  it('fails closed for legacy firmware unless configured thresholds are supplied', () => {
    expect(() => selectV2HandRecognitionStrategy(ok({ wifi_firmware: '10.0.19' }))).toThrow(UnsupportedHandRecognitionFirmwareError);
    const strategy = selectV2HandRecognitionStrategy(ok({ wifi_firmware: '10.0.19' }), { darkUpper: 101, brightLower: 301, brightUpper: 1201 });
    expect(handRecognitionCommand('present', strategy).params).toEqual({ du: '101', bl: '301', bu: '1201' });
    expect(interpretHandRecognitionResponse(ok({ hand: 0 }), 'present', strategy)).toBe(true);
    expect(interpretHandRecognitionResponse(ok({ hand: 1 }), 'removed', strategy)).toBe(true);
  });

  it('uses the APK strict threshold boundaries and inverts them for hand-off', () => {
    expect(interpretSampledHandMetrics({ dark: 2.99, near: 10.01, middle: 3.99, far: 1 }, 'present')).toBe(true);
    expect(interpretSampledHandMetrics({ dark: 3, near: 11, middle: 4, far: 1 }, 'present')).toBe(false);
    expect(interpretSampledHandMetrics({ dark: 2, near: 10, middle: 3, far: 1 }, 'present')).toBe(false);
    expect(interpretSampledHandMetrics({ dark: 2, near: 10.1, middle: 4.04, far: 1 }, 'present')).toBe(false);
    expect(interpretSampledHandMetrics({ dark: 3, near: 11, middle: 4, far: 1 }, 'removed')).toBe(true);
  });
});
