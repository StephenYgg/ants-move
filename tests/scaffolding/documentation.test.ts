import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('project documentation', () => {
  it('documents installation, collectors, aliases, and concurrency requirements', () => {
    const readme = readFileSync('README.md', 'utf8');
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies: { playwright: string };
    };

    for (const requiredText of [
      'npm install -g ants-move',
      `npx playwright@${packageJson.dependencies.playwright} install chromium`,
      'ants 36kr article',
      'ants 36kr list',
      'ants toutiao article',
      'ants toutiao list',
      'ants toutiao author',
      'ants hn top',
      'ants hn new',
      'ants hn best',
      'ants hn search',
      'amv',
      'hackernews',
      'external bounded queue',
      'shared rate limiter'
    ]) {
      expect(readme).toContain(requiredText);
    }
  });

  it('uses the MIT license with the project copyright holder', () => {
    const license = readFileSync('LICENSE', 'utf8');

    expect(license.startsWith('MIT License')).toBe(true);
    expect(license).toContain('Copyright (c) 2026 Stephen');
  });
});
