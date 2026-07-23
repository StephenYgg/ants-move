import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isMainEntrypoint } from '../src/index.js';

describe('isMainEntrypoint', () => {
  it('returns false when argv has no script path', () => {
    expect(isMainEntrypoint(import.meta.url, ['node'])).toBe(false);
  });

  it('returns false when argv names a different existing file', () => {
    expect(isMainEntrypoint(import.meta.url, ['node', fileURLToPath(new URL('../package.json', import.meta.url))])).toBe(false);
  });

  it('returns true when argv names the current module', () => {
    expect(isMainEntrypoint(import.meta.url, ['node', fileURLToPath(import.meta.url)])).toBe(true);
  });
});
