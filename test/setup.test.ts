import { describe, it, expect } from 'vitest';
import { APP_NAME, APP_VERSION } from '../src/index.js';

describe('Project setup', () => {
  it('should have correct app name', () => {
    expect(APP_NAME).toBe('teams-pr-tracker');
  });

  it('should have correct app version', () => {
    expect(APP_VERSION).toBe('1.0.0');
  });
});
