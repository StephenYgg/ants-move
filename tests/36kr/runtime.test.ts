import { describe, expect, it, vi } from 'vitest';

import {
  createDefaultKr36Runtime,
  type Kr36ExecFile
} from '../../src/36kr/runtime.js';

describe('36Kr runtime', () => {
  it('runs curl with request and resource bounds', async () => {
    const execFile = vi.fn<Kr36ExecFile>(async () => ({
      stderr: '',
      stdout: '<html></html>'
    }));
    const runtime = createDefaultKr36Runtime({ execFile });

    await expect(runtime.fetchArticleHtml({
      headers: {
        Accept: 'text/html',
        Referer: 'https://36kr.com/'
      },
      url: 'https://36kr.com/p/1'
    })).resolves.toBe('<html></html>');

    const [file, args, options] = execFile.mock.calls[0] ?? [];
    expect(file).toBe('curl');
    expect(args).toEqual(expect.arrayContaining([
      '--silent',
      '--show-error',
      '--location',
      '--compressed',
      '--connect-timeout',
      '10',
      '--max-time',
      '45',
      '--header',
      'Accept: text/html',
      'https://36kr.com/p/1'
    ]));
    expect(options).toMatchObject({
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024
    });
  });

  it('sends JSON bodies through curl', async () => {
    const execFile = vi.fn<Kr36ExecFile>(async () => ({
      stderr: '',
      stdout: '{}'
    }));
    const runtime = createDefaultKr36Runtime({ execFile });

    await runtime.fetchJson({
      body: { page: 2 },
      headers: { 'Content-Type': 'application/json' },
      url: 'https://gateway.36kr.com/page'
    });

    expect(execFile.mock.calls[0]?.[1]).toEqual(expect.arrayContaining([
      '--data-raw',
      '{"page":2}'
    ]));
  });

  it('returns a safe structured error when curl fails', async () => {
    const curlError = Object.assign(new Error('curl failed'), {
      code: 28,
      stderr: 'request timed out'
    });
    const execFile = vi.fn<Kr36ExecFile>(async () => {
      throw curlError;
    });
    const runtime = createDefaultKr36Runtime({ execFile });

    await expect(runtime.fetchArticleHtml({
      headers: { Cookie: 'secret' },
      url: 'https://36kr.com/p/1'
    })).rejects.toMatchObject({
      code: 'KR36_REQUEST_FAILED',
      details: {
        curlExitCode: 28,
        url: 'https://36kr.com/p/1'
      },
      exitCode: 1
    });

    try {
      await runtime.fetchArticleHtml({
        headers: { Cookie: 'secret' },
        url: 'https://36kr.com/p/1'
      });
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain('secret');
    }
  });

  it('uses a safe fallback when the process error could expose curl arguments', async () => {
    const execFile = vi.fn<Kr36ExecFile>(async () => {
      throw new Error('Command failed: curl --header Cookie: secret');
    });
    const runtime = createDefaultKr36Runtime({ execFile });

    const pending = runtime.fetchArticleHtml({
      headers: { Cookie: 'secret' },
      url: 'https://36kr.com/p/2'
    });

    await expect(pending).rejects.toMatchObject({
      message: 'Failed to fetch 36kr page: curl request failed.'
    });
    await pending.catch((error: unknown) => {
      expect(JSON.stringify(error)).not.toContain('secret');
    });
  });
});
