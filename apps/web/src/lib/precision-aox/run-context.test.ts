import { describe, expect, it } from 'vitest';
import { shouldAutoBeginPrecisionMeasurement } from './run-context';

describe('Precision measurement transitions', () => {
  it('requires the initial explicit Begin action', () => {
    expect(shouldAutoBeginPrecisionMeasurement(1, 'planned')).toBe(false);
  });

  it('automatically enters hand detection for planned measurements 2 through 4', () => {
    expect([2, 3, 4].map((index) => shouldAutoBeginPrecisionMeasurement(index, 'planned'))).toEqual([true, true, true]);
  });

  it('never automatically begins a rejected measurement replacement', () => {
    expect([1, 2, 3, 4].map((index) => shouldAutoBeginPrecisionMeasurement(index, 'replacement'))).toEqual([false, false, false, false]);
  });
});
