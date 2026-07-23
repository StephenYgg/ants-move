import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('package scaffolding', () => {
  it('publishes one entrypoint as the ants and amv executables', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      bin?: Record<string, string>;
      engines?: { node?: string };
      files?: string[];
    };

    expect(packageJson.bin).toEqual({
      amv: 'dist/index.js',
      ants: 'dist/index.js'
    });
    expect(packageJson.engines?.node).toBe('>=22.0.0');
    expect(packageJson.files).toEqual(['dist']);
  });

  it('builds an ESM Node 22 entrypoint with a shebang', () => {
    const buildConfig = readFileSync('tsup.config.ts', 'utf8');

    expect(buildConfig).toContain("js: '#!/usr/bin/env node'");
    expect(buildConfig).toContain("target: 'node22'");
  });
});
