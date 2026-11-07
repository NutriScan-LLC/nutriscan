import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { WifiBioZoomScanner, WifiScannerNotReadyError } from '../../src/scanner/WifiBioZoomScanner.js';
import { CapacitorHttpTransport, HttpTransportError, type HttpGetOptions, type HttpGetResponse, type HttpTransport } from '../../src/transport/HttpTransport.js';
import { UnsupportedHandRecognitionFirmwareError } from '../../src/protocol/handRecognition.js';
import { wifiHandPath, wifiReadFlashPath, WIFI_AOX_MEASURE_PATH, WIFI_DELETE_PATH } from '../../src/protocol/wifiHttp.js';

type Handler = (path: string, options: HttpGetOptions) => HttpGetResponse | Promise<HttpGetResponse>;

class FakeHttp implements HttpTransport {
  readonly baseUrl = 'http://192.168.4.1';
  readonly calls: string[] = [];
  constructor(private readonly handler: Handler) {}
  async get(path: string, options: HttpGetOptions): Promise<HttpGetResponse> {
    this.calls.push(path);
    return this.handler(path, options);
  }
}

// Shape of the /status body captured from 2E249C6AFCEA6BE8D5FF (subset).
const STATUS = JSON.stringify({ serial: '2E249C6AFCEA6BE8D5FF', url: '/status', wifi_firmware: '20.6.8', sensor_firmware: 608, wifi_mode: 'APSTA', busy: false });
const ok = (body: string, status = 200): HttpGetResponse => ({ status, bodyText: body });
const noWait = async () => {};

function crc(bytes: Uint8Array): number {
  let value = 0xffff;
  for (const byte of bytes) {
    value ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) value = value & 0x8000 ? ((value << 1) ^ 0x1021) & 0xffff : (value << 1) & 0xffff;
  }
  return value;
}
function block(logicalIndex: number): string {
  const internalIndex = logicalIndex === 0 ? 1 : logicalIndex; // confirmed first-block quirk
  const bytes = new Uint8Array(33);
  bytes[1] = 31; bytes[2] = internalIndex & 0xff; bytes[3] = internalIndex >> 8;
  for (let i = 4; i < 31; i++) bytes[i] = (logicalIndex + i) & 0xff;
  const c = crc(bytes.subarray(2, 31)); bytes[31] = c >> 8; bytes[32] = c & 0xff;
  return btoa(String.fromCharCode(...bytes));
}
// Captured value for a not-yet-written block (33 bytes of 0xFF).
const UNWRITTEN = '////////////////////////////////////////////';

async function identified(handler: Handler): Promise<{ scanner: WifiBioZoomScanner; http: FakeHttp }> {
  const http = new FakeHttp((path, options) => (path === '/status' ? ok(STATUS) : handler(path, options)));
  const scanner = new WifiBioZoomScanner(http, { wait: noWait });
  await scanner.connect();
  await scanner.identify();
  return { scanner, http };
}

describe('Wi-Fi command paths', () => {
  it('match the paths captured from the Biozoom app', () => {
    expect(WIFI_DELETE_PATH).toBe('/d');
    expect(WIFI_AOX_MEASURE_PATH).toBe('/m?type=aox');
    expect(wifiReadFlashPath(133, 5769, 4)).toBe('/read-flash?nr=133&block=5769&range=4');
    expect(wifiHandPath('present')).toBe('/h?start=110&count=13&cycles=5');
    expect(wifiHandPath('removed')).toBe('/h?start=134&count=10&cycles=25');
  });
});

describe('WifiBioZoomScanner connect/identify', () => {
  it('polls /status until the scanner answers, then identifies as V2 with its serial', async () => {
    let attempts = 0;
    const http = new FakeHttp(() => {
      attempts++;
      if (attempts < 3) throw new HttpTransportError('unreachable', '/status');
      return ok(STATUS);
    });
    const scanner = new WifiBioZoomScanner(http, { wait: noWait });
    await scanner.connect();
    const identity = await scanner.identify();
    expect(identity).toMatchObject({ serial: '2E249C6AFCEA6BE8D5FF', protocolVersion: 'v2', commandUsed: 'status' });
    expect(http.calls.every((p) => p === '/status')).toBe(true);
  });

  it('gives up after the APK 15 s ready window', async () => {
    let t = 0;
    const http = new FakeHttp(() => { throw new HttpTransportError('unreachable', '/status'); });
    const scanner = new WifiBioZoomScanner(http, { wait: async (ms) => { t += ms; }, now: () => new Date(t) });
    await expect(scanner.connect()).rejects.toBeInstanceOf(WifiScannerNotReadyError);
  });
});

describe('WifiBioZoomScanner.startAoxMeasurement', () => {
  it('sends /d then /m?type=aox, exactly like the Biozoom app', async () => {
    const { scanner, http } = await identified((path) => {
      if (path === '/d') return ok('Deleted');
      if (path === '/m?type=aox') return ok(JSON.stringify({ serial: '2E249C6AFCEA6BE8D5FF', url: '/m?type=aox', measurement_nr: 133, success: true, type: 'aox' }), 202);
      throw new Error(`unexpected ${path}`);
    });
    const start = await scanner.startAoxMeasurement();
    expect(start.measurementNumber).toBe(133);
    expect(http.calls.slice(-2)).toEqual(['/d', '/m?type=aox']);
  });

  it('never sends /m when cancelled after /d', async () => {
    const controller = new AbortController();
    const { scanner, http } = await identified((path) => {
      if (path === '/d') { controller.abort(); return ok('Deleted'); }
      throw new Error(`unexpected ${path}`);
    });
    await expect(scanner.startAoxMeasurement({ signal: controller.signal })).rejects.toBeDefined();
    expect(http.calls).not.toContain('/m?type=aox');
  });

  it('does not measure when /d fails', async () => {
    const { scanner, http } = await identified((path) => (path === '/d' ? ok('', 500) : ok('{}')));
    await expect(scanner.startAoxMeasurement()).rejects.toThrow(/HTTP 500/);
    expect(http.calls).not.toContain('/m?type=aox');
  });

  it('rejects an acknowledgment without a valid measurement number', async () => {
    const { scanner } = await identified((path) => (path === '/d' ? ok('Deleted') : ok(JSON.stringify({ type: 'aox', success: true }), 202)));
    await expect(scanner.startAoxMeasurement()).rejects.toThrow(/measurement_nr/);
  });
});

describe('WifiBioZoomScanner.downloadAoxMeasurement', () => {
  it('re-reads blocks that were still unwritten (0xFF) and completes with CRC-valid data', async () => {
    let lastBlockReads = 0;
    const { scanner, http } = await identified((path) => {
      const m = /block=(\d+)&range=(\d+)/.exec(path);
      if (!m) throw new Error(`unexpected ${path}`);
      const start = Number(m[1]); const range = Number(m[2]);
      const data = Array.from({ length: range }, (_, i) => {
        const index = start + i;
        if (index === 5) { lastBlockReads++; return lastBlockReads < 2 ? UNWRITTEN : block(index); }
        return block(index);
      });
      return ok(JSON.stringify({ measurement_nr: 7, measurement_type: 'aox', data_blocks: 6, data_blocks_index: start, data_blocks_requested: range, data }));
    });
    const waits: number[] = [];
    const artifact = await scanner.downloadAoxMeasurement(7, {
      profile: { type: 'aox', logicalBlockCount: 6, blockByteLength: 33 },
      range: 3,
      wait: async (ms) => { waits.push(ms); },
    });
    expect(artifact.summary.complete).toBe(true);
    expect(artifact.retryRounds).toBe(1);
    expect(lastBlockReads).toBe(2);
    expect(http.calls.filter((p) => p.startsWith('/read-flash?nr=7&'))).toHaveLength(3);
  });
});

describe('WifiBioZoomScanner hand recognition', () => {
  // Five /h responses captured from the Biozoom app on 2026-11-06. The app
  // advanced after the 3rd hand-on sample and the 2nd hand-off sample.
  const captured = JSON.parse(readFileSync(new URL('../fixtures/wifi-hand-capture-2026-11-06.json', import.meta.url), 'utf8')) as Array<{ path: string; data: string[] }>;

  it('reproduces the Biozoom app decisions on captured /h data', async () => {
    const queue = [...captured];
    const { scanner } = await identified((path) => {
      const next = queue.shift();
      if (!next || next.path !== path) throw new Error(`unexpected ${path}`);
      return ok(JSON.stringify({ serial: '2E249C6AFCEA6BE8D5FF', url: path, data: next.data }));
    });
    await scanner.prepareHandRecognition('present');
    await scanner.prepareHandRecognition('removed');
    const present = [await scanner.recognizeHand('present'), await scanner.recognizeHand('present'), await scanner.recognizeHand('present')];
    const removed = [await scanner.recognizeHand('removed'), await scanner.recognizeHand('removed')];
    expect(present).toEqual([false, false, true]);
    expect(removed).toEqual([false, true]);
  });

  it('retries the status read before hand-off detection', async () => {
    let statusCalls = 0;
    const http = new FakeHttp((path) => {
      if (path === '/status') {
        statusCalls++;
        if (statusCalls === 3 || statusCalls === 4) throw new HttpTransportError('dropped', '/status');
        return ok(STATUS);
      }
      throw new Error(`unexpected ${path}`);
    });
    const scanner = new WifiBioZoomScanner(http, { wait: noWait });
    await scanner.connect(); await scanner.identify();
    await expect(scanner.prepareHandRecognition('removed')).resolves.toBeUndefined();
    expect(statusCalls).toBe(5);
  });

  it('treats a failed /h request as "not yet" (APK behavior)', async () => {
    const { scanner } = await identified(() => { throw new HttpTransportError('timeout', '/h'); });
    await scanner.prepareHandRecognition('present');
    expect(await scanner.recognizeHand('present')).toBe(false);
  });

  it('refuses firmware that needs the legacy hand path', async () => {
    const http = new FakeHttp(() => ok(JSON.stringify({ serial: 'X', wifi_firmware: '9.0.1', sensor_firmware: 608 })));
    const scanner = new WifiBioZoomScanner(http, { wait: noWait });
    await scanner.connect(); await scanner.identify();
    await expect(scanner.prepareHandRecognition('present')).rejects.toBeInstanceOf(UnsupportedHandRecognitionFirmwareError);
  });
});

describe('CapacitorHttpTransport', () => {
  const g = globalThis as unknown as { Capacitor?: unknown };
  afterEach(() => { delete g.Capacitor; });

  it('re-serializes bodies the native plugin already parsed as JSON', async () => {
    g.Capacitor = { isNativePlatform: () => true, Plugins: { CapacitorHttp: { request: async () => ({ status: 200, data: { serial: 'S', busy: false } }) } } };
    const response = await new CapacitorHttpTransport({ baseUrl: 'http://192.168.4.1/' }).get('/status', { timeoutMs: 1000 });
    expect(response).toEqual({ status: 200, bodyText: '{"serial":"S","busy":false}' });
  });

  it('fails clearly outside the NutriScan app', async () => {
    await expect(new CapacitorHttpTransport({ baseUrl: 'http://192.168.4.1' }).get('/status', { timeoutMs: 1000 })).rejects.toThrow(/not available/);
  });
});
