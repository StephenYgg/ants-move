import { describe, expect, it, vi } from 'vitest';

import { createCli } from '../../src/index.js';
import { handleMediaCommandError } from '../../src/media/command.js';
import { MediaCommandError } from '../../src/media/types.js';

const FEED = `<?xml version="1.0"?><rss><channel>
<item><title>T</title><link>https://www.wired.com/story/t/</link><guid>1</guid></item>
</channel></rss>`;

describe('media command branches', () => {
  it('supports table output and invalid limit parser errors', async () => {
    let stdout = '';
    let stderr = '';
    const cli = createCli({
      mediaRuntime: { fetchText: vi.fn(async () => FEED) },
      stderr: (value) => {
        stderr += value;
      },
      stdout: (value) => {
        stdout += value;
      }
    });

    expect(await cli.run(['wired', 'list', 'AI', '-t'])).toBe(0);
    expect(stdout).toContain('title');

    stderr = '';
    const code = await cli.run(['wired', 'list', 'AI', '--limit', 'nope']);
    expect(code).toBe(2);
    expect(stderr).toContain('MEDIA_INVALID_LIMIT');
  });

  it('handles MediaCommandError via helper and ignores other errors', () => {
    let stderr = '';
    const code = handleMediaCommandError(
      new MediaCommandError('MEDIA_PARSE_ERROR', 'bad', 2, { x: 1 }),
      {
        stderr: (value) => {
          stderr += value;
        }
      }
    );
    expect(code).toBe(2);
    expect(stderr).toContain('MEDIA_PARSE_ERROR');
    expect(handleMediaCommandError(new Error('x'), { stderr: () => undefined })).toBeUndefined();
  });

  it('rejects empty article refs through service path', async () => {
    let stderr = '';
    const cli = createCli({
      mediaRuntime: {
        fetchText: vi.fn(async () => {
          throw new Error('should not fetch');
        })
      },
      stderr: (value) => {
        stderr += value;
      },
      stdout: () => undefined
    });

    const code = await cli.run(['wired', 'article', '   ']);
    expect(code).toBe(2);
    expect(stderr).toContain('MEDIA_INVALID_ARTICLE');
  });

  it('accepts case-insensitive channel names', async () => {
    let stdout = '';
    const cli = createCli({
      mediaRuntime: { fetchText: vi.fn(async () => FEED) },
      stderr: () => undefined,
      stdout: (value) => {
        stdout += value;
      }
    });

    expect(await cli.run(['wired', 'list', 'ai'])).toBe(0);
    expect(JSON.parse(stdout).data.channel).toBe('AI');
  });

  it('honors explicit --format json without table shortcut', async () => {
    let stdout = '';
    const cli = createCli({
      mediaRuntime: { fetchText: vi.fn(async () => FEED) },
      stderr: () => undefined,
      stdout: (value) => {
        stdout += value;
      }
    });

    expect(await cli.run(['wired', 'list', 'AI', '--format', 'json'])).toBe(0);
    expect(JSON.parse(stdout).ok).toBe(true);
  });
});
