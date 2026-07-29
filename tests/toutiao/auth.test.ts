import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToutiaoAuthService } from '../../src/toutiao/auth.js';
import type { ToutiaoPublishRuntime } from '../../src/toutiao/publish-runtime.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (dir) => {
    await rm(dir, { force: true, recursive: true });
  }));
});

describe('ToutiaoAuthService', () => {
  it('logs in through the publish runtime and returns account status', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ants-auth-'));
    tempDirs.push(dir);
    const statePath = join(dir, 'state.json');
    const loginWithQr = vi.fn(async (options: { statePath: string }) => ({
      account: { mediaId: '123', name: 'Media' },
      loggedIn: true as const,
      statePath: options.statePath
    }));
    const runtime: ToutiaoPublishRuntime = {
      loginWithQr,
      withAuthedSession: vi.fn()
    };
    const service = new ToutiaoAuthService({ publishRuntime: runtime });

    const result = await service.login({ statePath });

    expect(result.loggedIn).toBe(true);
    expect(result.account?.name).toBe('Media');
    expect(loginWithQr).toHaveBeenCalledWith(expect.objectContaining({ statePath }));
  });

  it('reports logged out when the state file is missing', async () => {
    const runtime: ToutiaoPublishRuntime = {
      loginWithQr: vi.fn(),
      withAuthedSession: vi.fn()
    };
    const service = new ToutiaoAuthService({ publishRuntime: runtime });
    const statePath = join(tmpdir(), `missing-${Date.now()}.json`);

    const result = await service.status({ statePath });

    expect(result).toEqual({
      loggedIn: false,
      statePath
    });
    expect(runtime.withAuthedSession).not.toHaveBeenCalled();
  });

  it('checks session validity when the state file exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ants-auth-'));
    tempDirs.push(dir);
    const statePath = join(dir, 'state.json');
    await writeFile(statePath, '{}');
    const runtime: ToutiaoPublishRuntime = {
      loginWithQr: vi.fn(),
      withAuthedSession: vi.fn(async (_options, operation) => operation({
        getStatus: async () => ({
          account: { name: 'Media' },
          loggedIn: true,
          statePath
        }),
        publishArticle: vi.fn(),
        publishMicro: vi.fn()
      }))
    };
    const service = new ToutiaoAuthService({ publishRuntime: runtime });

    const result = await service.status({ statePath });

    expect(result.loggedIn).toBe(true);
    expect(result.account?.name).toBe('Media');
  });

  it('logout removes the state file and is idempotent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ants-auth-'));
    tempDirs.push(dir);
    const statePath = join(dir, 'state.json');
    await writeFile(statePath, '{}');
    const runtime: ToutiaoPublishRuntime = {
      loginWithQr: vi.fn(),
      withAuthedSession: vi.fn()
    };
    const service = new ToutiaoAuthService({ publishRuntime: runtime });

    const first = await service.logout({ statePath });
    const second = await service.logout({ statePath });

    expect(first.loggedIn).toBe(false);
    expect(second.loggedIn).toBe(false);
  });
});
