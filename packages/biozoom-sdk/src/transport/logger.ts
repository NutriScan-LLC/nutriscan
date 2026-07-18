export type RawByteDirection = 'write' | 'read';

/**
 * Hook for observing raw bytes crossing the transport boundary. Has no
 * knowledge of BioZoom framing — it only ever sees bytes.
 */
export interface TransportLogger {
  onRawBytes?(direction: RawByteDirection, bytes: Uint8Array): void;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(' ');
}

export const noopLogger: TransportLogger = {};

export const consoleLogger: TransportLogger = {
  onRawBytes(direction, bytes) {
    console.debug(`[transport:${direction}] (${bytes.length}B) ${toHex(bytes)}`);
  },
};
