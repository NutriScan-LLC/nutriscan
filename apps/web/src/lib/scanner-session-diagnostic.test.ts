import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScannerRunGuard, ScannerSessionDiagnostic, scannerSessionOwnership } from './scanner-session-diagnostic';

afterEach(() => scannerSessionOwnership.resetForTest());

describe('scanner session ownership', () => {
  it('prevents Quick and Precision from owning the scanner concurrently', () => {
    scannerSessionOwnership.claim('quick');
    expect(() => scannerSessionOwnership.claim('precision')).toThrow('Another NutriScan scanner session is active');
    scannerSessionOwnership.release('quick');
    expect(() => scannerSessionOwnership.claim('precision')).not.toThrow();
  });

  it('reports whether another session was active without recording scanner identity', () => {
    scannerSessionOwnership.claim('other');
    const changed = vi.fn();
    const diagnostic = new ScannerSessionDiagnostic(changed);
    diagnostic.startRun('quick-aox');
    const report = changed.mock.calls.at(-1)?.[0];
    expect(report.events[0]).toMatchObject({ kind: 'run-started', anotherScannerSessionActive: true });
    expect(JSON.stringify(report)).not.toContain('serial');
  });
});

describe('scanner run guard', () => {
  it('allows only one rapid start and fully awaits its settlement', async () => {
    const guard = new ScannerRunGuard();
    expect(guard.tryStart('first')).toBe(true);
    expect(guard.tryStart('second')).toBe(false);
    let resolve!: () => void;
    const pending = new Promise<void>((done) => { resolve = done; });
    guard.attach('first', pending);
    const waited = vi.fn();
    const waiting = guard.awaitCurrentSettlement().then(waited);
    await Promise.resolve();
    expect(waited).not.toHaveBeenCalled();
    resolve();
    await waiting;
    expect(waited).toHaveBeenCalledOnce();
  });

  it('does not let a stale completion finish a newer run', () => {
    const guard = new ScannerRunGuard();
    expect(guard.tryStart('old')).toBe(true);
    guard.finish('old');
    expect(guard.tryStart('new')).toBe(true);
    guard.finish('old');
    expect(guard.isCurrent('new')).toBe(true);
  });
});
