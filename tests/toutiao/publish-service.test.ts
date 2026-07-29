import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  ToutiaoAuthedSession,
  ToutiaoPublishRuntime
} from '../../src/toutiao/publish-runtime.js';
import { ToutiaoPublishService } from '../../src/toutiao/publish-service.js';
import { ToutiaoCommandError } from '../../src/toutiao/types.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (dir) => {
    await rm(dir, { force: true, recursive: true });
  }));
});

function createPublishRuntime(sessionOverrides: Partial<ToutiaoAuthedSession> = {}): {
  publishArticle: ReturnType<typeof vi.fn>;
  publishMicro: ReturnType<typeof vi.fn>;
  runtime: ToutiaoPublishRuntime;
} {
  const publishArticle = vi.fn(async (input: { strategy: string; title: string }) => ({
    status: input.strategy === 'draft' ? 'draft_saved' as const : 'published' as const,
    strategy: input.strategy as 'draft' | 'publish',
    title: input.title,
    type: 'article' as const
  }));
  const publishMicro = vi.fn(async (input: { strategy: string }) => ({
    status: input.strategy === 'draft' ? 'draft_saved' as const : 'published' as const,
    strategy: input.strategy as 'draft' | 'publish',
    type: 'micro' as const
  }));

  const session: ToutiaoAuthedSession = {
    getStatus: vi.fn(async () => ({
      account: { name: 'Test Media' },
      loggedIn: true,
      statePath: '/tmp/state.json'
    })),
    publishArticle,
    publishMicro,
    ...sessionOverrides
  };

  const runtime: ToutiaoPublishRuntime = {
    loginWithQr: vi.fn(async ({ statePath }) => ({
      account: { name: 'Test Media' },
      loggedIn: true,
      statePath
    })),
    withAuthedSession: vi.fn(async (_options, operation) => operation(session))
  };

  return { publishArticle, publishMicro, runtime };
}

describe('ToutiaoPublishService', () => {
  it('defaults article strategy to draft', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ants-publish-'));
    tempDirs.push(dir);
    const statePath = join(dir, 'state.json');
    await writeFile(statePath, '{}');
    const { publishArticle, runtime } = createPublishRuntime();
    const service = new ToutiaoPublishService({ publishRuntime: runtime });

    const result = await service.publishArticle({
      content: 'Body text',
      statePath,
      title: 'Hello draft'
    });

    expect(result.strategy).toBe('draft');
    expect(result.status).toBe('draft_saved');
    expect(publishArticle).toHaveBeenCalledWith(expect.objectContaining({
      strategy: 'draft',
      title: 'Hello draft'
    }));
  });

  it('requires explicit publish strategy for live submit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ants-publish-'));
    tempDirs.push(dir);
    const statePath = join(dir, 'state.json');
    await writeFile(statePath, '{}');
    const { publishArticle, runtime } = createPublishRuntime();
    const service = new ToutiaoPublishService({ publishRuntime: runtime });

    const result = await service.publishArticle({
      content: 'Body text',
      statePath,
      strategy: 'publish',
      title: 'Live post'
    });

    expect(result.strategy).toBe('publish');
    expect(result.status).toBe('published');
    expect(publishArticle).toHaveBeenCalledWith(expect.objectContaining({
      strategy: 'publish'
    }));
  });

  it('rejects missing content sources and dual content sources', async () => {
    const service = new ToutiaoPublishService({
      publishRuntime: createPublishRuntime().runtime
    });

    await expect(service.publishArticle({
      title: 'No body'
    })).rejects.toMatchObject({
      code: 'TOUTIAO_INVALID_INPUT'
    } satisfies Partial<ToutiaoCommandError>);

    await expect(service.publishArticle({
      content: 'a',
      contentFile: '/tmp/x.md',
      title: 'Both'
    })).rejects.toMatchObject({
      code: 'TOUTIAO_INVALID_INPUT'
    });
  });

  it('dry-run validates auth state without calling publish', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ants-publish-'));
    tempDirs.push(dir);
    const statePath = join(dir, 'state.json');
    await writeFile(statePath, '{}');
    const { publishArticle, runtime } = createPublishRuntime();
    const service = new ToutiaoPublishService({ publishRuntime: runtime });

    const result = await service.publishArticle({
      content: 'Body',
      dryRun: true,
      statePath,
      title: 'Dry'
    });

    expect(result.status).toBe('dry_run');
    expect(result.strategy).toBe('draft');
    expect(publishArticle).not.toHaveBeenCalled();
    expect(runtime.withAuthedSession).not.toHaveBeenCalled();
  });

  it('dry-run fails when auth state is missing', async () => {
    const service = new ToutiaoPublishService({
      publishRuntime: createPublishRuntime().runtime
    });

    await expect(service.publishArticle({
      content: 'Body',
      dryRun: true,
      statePath: join(tmpdir(), 'missing-toutiao-state.json'),
      title: 'Dry'
    })).rejects.toMatchObject({
      code: 'TOUTIAO_AUTH_REQUIRED'
    });
  });

  it('defaults micro strategy to draft and enforces image limits', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ants-publish-'));
    tempDirs.push(dir);
    const statePath = join(dir, 'state.json');
    const imagePath = join(dir, 'a.jpg');
    await writeFile(statePath, '{}');
    await writeFile(imagePath, 'fake-image');
    const { publishMicro, runtime } = createPublishRuntime();
    const service = new ToutiaoPublishService({ publishRuntime: runtime });

    const result = await service.publishMicro({
      content: 'Micro body',
      images: [imagePath],
      statePath
    });

    expect(result.strategy).toBe('draft');
    expect(publishMicro).toHaveBeenCalledWith(expect.objectContaining({
      imagePaths: [imagePath],
      strategy: 'draft'
    }));

    await expect(service.publishMicro({
      content: 'too many',
      images: Array.from({ length: 10 }, (_, index) => `${imagePath}-${index}`),
      statePath
    })).rejects.toMatchObject({
      code: 'TOUTIAO_INVALID_INPUT'
    });
  });

  it('reads article content from a file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ants-publish-'));
    tempDirs.push(dir);
    const statePath = join(dir, 'state.json');
    const contentFile = join(dir, 'body.md');
    await writeFile(statePath, '{}');
    await writeFile(contentFile, 'File body');
    const { publishArticle, runtime } = createPublishRuntime();
    const service = new ToutiaoPublishService({ publishRuntime: runtime });

    await service.publishArticle({
      contentFile,
      statePath,
      title: 'From file'
    });

    expect(publishArticle).toHaveBeenCalledWith(expect.objectContaining({
      content: 'File body'
    }));
  });
});
