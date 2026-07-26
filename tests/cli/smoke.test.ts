import { describe, expect, it } from 'vitest';

import { createCli } from '../../src/index.js';

describe('ants CLI', () => {
  it('renders English top-level help through injected output', async () => {
    let stdout = '';
    const cli = createCli({
      stderr: () => undefined,
      stdout: (value) => {
        stdout += value;
      }
    });

    expect(await cli.run(['--help'])).toBe(0);
    expect(stdout).toContain('Usage: ants');
    expect(stdout).toContain('Move data between systems');
    expect(stdout).toContain('36kr');
    expect(stdout).toContain('toutiao');
    expect(stdout).toContain('hn|hackernews');
    expect(stdout).toContain('github');
    expect(stdout).not.toMatch(/^\s+(?:ak|config|disk|video|stephen)\b/m);
  });
});
