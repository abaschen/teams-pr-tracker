import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

describe('Property-based testing setup', () => {
  it('fast-check is properly configured', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        expect(a + b).toBe(b + a);
      }),
      { numRuns: 100 },
    );
  });
});
