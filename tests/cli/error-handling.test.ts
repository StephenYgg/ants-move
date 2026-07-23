import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { createCli } from '../../src/index.js';
import type { HackerNewsRuntime } from '../../src/hn/runtime.js';

function parseError(stderr: string): {
  error: { code: string; message: string };
  ok: boolean;
} {
  return JSON.parse(stderr) as {
    error: { code: string; message: string };
    ok: boolean;
  };
}

function createFailingHackerNewsRuntime(): HackerNewsRuntime {
  return {
    fetchSearch: vi.fn(async () => {
      throw new Error('unexpected upstream failure with Cookie: secret');
    }),
    fetchStories: vi.fn(async () => {
      throw new Error('unexpected upstream failure with Cookie: secret');
    })
  };
}

describe('CLI error handling', () => {
  it('normalizes Zod format errors as INVALID_ARGUMENT JSON', async () => {
    let stderr = '';
    const cli = createCli({
      stderr: (value) => {
        stderr += value;
      },
      stdout: () => undefined
    });

    const exitCode = await cli.run([
      'toutiao',
      'article',
      '7657359132571255323',
      '--format',
      'table'
    ]);

    expect(exitCode).toBe(2);
    expect(parseError(stderr)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' }
    });
  });

  it('normalizes missing Commander arguments as INVALID_ARGUMENT JSON', async () => {
    let stderr = '';
    const cli = createCli({
      stderr: (value) => {
        stderr += value;
      },
      stdout: () => undefined
    });

    const exitCode = await cli.run(['36kr', 'article']);

    expect(exitCode).toBe(2);
    expect(parseError(stderr)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' }
    });
  });

  it('preserves known collector errors and their exit codes', async () => {
    let stderr = '';
    const cli = createCli({
      stderr: (value) => {
        stderr += value;
      },
      stdout: () => undefined
    });

    const exitCode = await cli.run(['toutiao', 'list', 'sports']);

    expect(exitCode).toBe(2);
    expect(parseError(stderr)).toMatchObject({
      ok: false,
      error: { code: 'TOUTIAO_INVALID_SOURCE' }
    });
  });

  it('renders unexpected errors without a stack trace', async () => {
    let stderr = '';
    const cli = createCli({
      hackerNewsRuntime: createFailingHackerNewsRuntime(),
      stderr: (value) => {
        stderr += value;
      },
      stdout: () => undefined
    });

    const exitCode = await cli.run(['hn', 'top', '--limit', '1']);

    expect(exitCode).toBe(1);
    expect(parseError(stderr)).toEqual({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected internal error occurred.'
      }
    });
    expect(stderr).not.toContain('at ');
    expect(stderr).not.toContain('Error:');
    expect(stderr).not.toContain('secret');
  });

  it('uses a stable fallback message for an empty Zod error', async () => {
    let stderr = '';
    const runtime: HackerNewsRuntime = {
      fetchSearch: vi.fn(),
      fetchStories: vi.fn(async () => {
        throw new ZodError([]);
      })
    };
    const cli = createCli({
      hackerNewsRuntime: runtime,
      stderr: (value) => { stderr += value; },
      stdout: () => undefined
    });

    expect(await cli.run(['hn', 'top', '--limit', '1'])).toBe(2);
    expect(parseError(stderr).error.message).toBe('Invalid command arguments.');
  });

  it('does not expose unexpected non-Error values', async () => {
    let stderr = '';
    const runtime: HackerNewsRuntime = {
      fetchSearch: vi.fn(),
      fetchStories: vi.fn(async () => {
        throw 'unexpected string failure';
      })
    };
    const cli = createCli({
      hackerNewsRuntime: runtime,
      stderr: (value) => { stderr += value; },
      stdout: () => undefined
    });

    expect(await cli.run(['hn', 'top', '--limit', '1'])).toBe(1);
    expect(parseError(stderr).error.message).toBe('An unexpected internal error occurred.');
    expect(stderr).not.toContain('unexpected string failure');
  });

  it('writes through the process streams when IO is not injected', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(await createCli().run(['--help'])).toBe(0);
      expect(await createCli().run(['36kr', 'article'])).toBe(2);
      expect(stdout).toHaveBeenCalled();
      expect(stderr).toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
});
