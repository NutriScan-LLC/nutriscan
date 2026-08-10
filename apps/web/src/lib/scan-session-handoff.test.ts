import { describe, expect, it, vi } from 'vitest';
import { handoffScannerSession } from './scan-session-handoff';

describe('scan session handoff', () => {
  it('does not start Quick until Precision workflow settlement and transport closure finish', async () => {
    const order: string[] = [];
    let finishRelease!: () => void;
    const release = vi.fn(() => new Promise<void>((resolve) => { finishRelease = () => { order.push('released'); resolve(); }; }));
    const start = vi.fn(() => order.push('started'));
    const handoff = handoffScannerSession(release, start);
    await Promise.resolve();
    expect(start).not.toHaveBeenCalled();
    finishRelease();
    await handoff;
    expect(order).toEqual(['released', 'started']);
  });

  it('does not start Precision when Quick release fails', async () => {
    const start = vi.fn();
    await expect(handoffScannerSession(async () => { throw new Error('close failed'); }, start)).rejects.toThrow('close failed');
    expect(start).not.toHaveBeenCalled();
  });
});
