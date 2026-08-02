import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCli } from '../../src/index.js';
import type {
  ToutiaoAuthedSession,
  ToutiaoPublishRuntime
} from '../../src/toutiao/publish-runtime.js';
import type { ToutiaoRuntime, ToutiaoSession } from '../../src/toutiao/runtime.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (dir) => {
    await rm(dir, { force: true, recursive: true });
  }));
});

function createCollectorRuntime(): ToutiaoRuntime {
  const session: ToutiaoSession = {
    fetchArticle: vi.fn(),
    fetchAuthorArticles: vi.fn(),
    fetchKeywordInformation: vi.fn(),
    fetchTechnologyChannel: vi.fn()
  };

  return {
    withSession: vi.fn(async (operation) => operation(session))
  };
}

function createPublishRuntime(sessionOverrides: Partial<ToutiaoAuthedSession> = {}): {
  publishArticle: ReturnType<typeof vi.fn>;
  publishMicro: ReturnType<typeof vi.fn>;
  runtime: ToutiaoPublishRuntime;
} {
  const publishArticle = vi.fn(async (input: { strategy: 'draft' | 'publish'; title: string }) => ({
    draftId: 'pgc-1',
    editUrl: 'https://mp.toutiao.com/profile_v4/graphic/publish?pgc_id=1',
    status: input.strategy === 'draft' ? 'draft_saved' as const : 'published' as const,
    strategy: input.strategy,
    title: input.title,
    type: 'article' as const
  }));
  const publishMicro = vi.fn(async (input: { strategy: 'draft' | 'publish' }) => ({
    status: input.strategy === 'draft' ? 'draft_saved' as const : 'published' as const,
    strategy: input.strategy,
    type: 'micro' as const
  }));
  const session: ToutiaoAuthedSession = {
    getStatus: vi.fn(async () => ({
      account: { name: 'CLI Media' },
      loggedIn: true,
      statePath: '/tmp/state.json'
    })),
    publishArticle,
    publishMicro,
    ...sessionOverrides
  };

  return {
    publishArticle,
    publishMicro,
    runtime: {
      loginWithQr: vi.fn(async ({ statePath }) => ({
        account: { name: 'CLI Media' },
        loggedIn: true,
        statePath
      })),
      withAuthedSession: vi.fn(async (_options, operation) => operation(session))
    }
  };
}

async function writeFakeImages(dir: string, count: number): Promise<string[]> {
  const paths: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const path = join(dir, `cli-img-${index}.png`);
    await writeFile(path, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    paths.push(path);
  }
  return paths;
}

describe('ants toutiao auth and publish commands', () => {
  it('logs in and prints auth status JSON', async () => {
    let stdout = '';
    const dir = await mkdtemp(join(tmpdir(), 'ants-cli-auth-'));
    tempDirs.push(dir);
    const statePath = join(dir, 'state.json');
    const { runtime } = createPublishRuntime();
    const cli = createCli({
      stdout: (value) => {
        stdout += value;
      },
      toutiaoPublishRuntime: runtime,
      toutiaoRuntime: createCollectorRuntime()
    });

    const exitCode = await cli.run([
      'toutiao',
      'auth',
      'login',
      '--state',
      statePath
    ]);
    const parsed = JSON.parse(stdout) as {
      data: { account?: { name?: string }; loggedIn: boolean };
      ok: boolean;
    };

    expect(exitCode).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.loggedIn).toBe(true);
    expect(parsed.data.account?.name).toBe('CLI Media');
    expect(runtime.loginWithQr).toHaveBeenCalled();
  });

  it('publishes an article draft by default', async () => {
    let stdout = '';
    const dir = await mkdtemp(join(tmpdir(), 'ants-cli-publish-'));
    tempDirs.push(dir);
    const statePath = join(dir, 'state.json');
    await writeFile(statePath, '{}');
    const images = await writeFakeImages(dir, 3);
    const { publishArticle, runtime } = createPublishRuntime();
    const cli = createCli({
      stdout: (value) => {
        stdout += value;
      },
      toutiaoPublishRuntime: runtime,
      toutiaoRuntime: createCollectorRuntime()
    });

    const exitCode = await cli.run([
      'toutiao',
      'publish',
      'article',
      '--title',
      'Draft title',
      '--content',
      'Draft body',
      '--images',
      images.join(','),
      '--state',
      statePath
    ]);
    const parsed = JSON.parse(stdout) as {
      data: { status: string; strategy: string; type: string };
      ok: boolean;
    };

    expect(exitCode).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.type).toBe('article');
    expect(parsed.data.strategy).toBe('draft');
    expect(parsed.data.status).toBe('draft_saved');
    expect(publishArticle).toHaveBeenCalledWith(expect.objectContaining({
      bodyImagePaths: images,
      strategy: 'draft',
      title: 'Draft title'
    }));
  });

  it('requires --strategy publish for live article submit', async () => {
    let stdout = '';
    const dir = await mkdtemp(join(tmpdir(), 'ants-cli-publish-'));
    tempDirs.push(dir);
    const statePath = join(dir, 'state.json');
    await writeFile(statePath, '{}');
    const images = await writeFakeImages(dir, 3);
    const { publishArticle, runtime } = createPublishRuntime();
    const cli = createCli({
      stdout: (value) => {
        stdout += value;
      },
      toutiaoPublishRuntime: runtime,
      toutiaoRuntime: createCollectorRuntime()
    });

    const exitCode = await cli.run([
      'toutiao',
      'publish',
      'article',
      '--title',
      'Live title',
      '--content',
      'Live body',
      '--images',
      images.join(','),
      '--strategy',
      'publish',
      '--state',
      statePath
    ]);
    const parsed = JSON.parse(stdout) as {
      data: { status: string; strategy: string };
      ok: boolean;
    };

    expect(exitCode).toBe(0);
    expect(parsed.data.strategy).toBe('publish');
    expect(parsed.data.status).toBe('published');
    expect(publishArticle).toHaveBeenCalledWith(expect.objectContaining({
      strategy: 'publish'
    }));
  });

  it('creates a micro-post draft by default', async () => {
    let stdout = '';
    const dir = await mkdtemp(join(tmpdir(), 'ants-cli-micro-'));
    tempDirs.push(dir);
    const statePath = join(dir, 'state.json');
    await writeFile(statePath, '{}');
    const images = await writeFakeImages(dir, 2);
    const { publishMicro, runtime } = createPublishRuntime();
    const cli = createCli({
      stdout: (value) => {
        stdout += value;
      },
      toutiaoPublishRuntime: runtime,
      toutiaoRuntime: createCollectorRuntime()
    });

    const exitCode = await cli.run([
      'toutiao',
      'publish',
      'micro',
      '--content',
      'Hello micro',
      '--images',
      images.join(','),
      '--state',
      statePath
    ]);
    const parsed = JSON.parse(stdout) as {
      data: { status: string; strategy: string; type: string };
      ok: boolean;
    };

    expect(exitCode).toBe(0);
    expect(parsed.data.type).toBe('micro');
    expect(parsed.data.strategy).toBe('draft');
    expect(parsed.data.status).toBe('draft_saved');
    expect(publishMicro).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Hello micro',
      imagePaths: images,
      strategy: 'draft'
    }));
  });

  it('returns structured invalid input errors for publish article', async () => {
    let stderr = '';
    const { runtime } = createPublishRuntime();
    const cli = createCli({
      stderr: (value) => {
        stderr += value;
      },
      stdout: () => undefined,
      toutiaoPublishRuntime: runtime,
      toutiaoRuntime: createCollectorRuntime()
    });

    const exitCode = await cli.run([
      'toutiao',
      'publish',
      'article',
      '--title',
      'Missing body'
    ]);

    expect(exitCode).toBe(2);
    expect(stderr).toContain('"code": "TOUTIAO_INVALID_INPUT"');
  });

  it('supports dry-run without invoking the publisher session', async () => {
    let stdout = '';
    const dir = await mkdtemp(join(tmpdir(), 'ants-cli-dry-'));
    tempDirs.push(dir);
    const statePath = join(dir, 'state.json');
    await writeFile(statePath, '{}');
    const images = await writeFakeImages(dir, 3);
    const { publishArticle, runtime } = createPublishRuntime();
    const cli = createCli({
      stdout: (value) => {
        stdout += value;
      },
      toutiaoPublishRuntime: runtime,
      toutiaoRuntime: createCollectorRuntime()
    });

    const exitCode = await cli.run([
      'toutiao',
      'publish',
      'article',
      '--title',
      'Dry title',
      '--content',
      'Dry body',
      '--images',
      images.join(','),
      '--dry-run',
      '--state',
      statePath
    ]);
    const parsed = JSON.parse(stdout) as {
      data: { status: string; strategy: string };
      ok: boolean;
    };

    expect(exitCode).toBe(0);
    expect(parsed.data.status).toBe('dry_run');
    expect(parsed.data.strategy).toBe('draft');
    expect(publishArticle).not.toHaveBeenCalled();
  });
});
