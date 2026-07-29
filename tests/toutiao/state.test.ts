import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  resolveToutiaoStatePath,
  withToutiaoStateLock,
  writeStateFile
} from '../../src/toutiao/state.js';
import { ToutiaoCommandError } from '../../src/toutiao/types.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (dir) => {
    await rm(dir, { force: true, recursive: true });
  }));
});

describe('toutiao state helpers', () => {
  it('resolves an explicit state path', () => {
    expect(resolveToutiaoStatePath('/tmp/custom-state.json')).toBe('/tmp/custom-state.json');
  });

  it('writes state files with restrictive mode metadata path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ants-toutiao-state-'));
    tempDirs.push(dir);
    const statePath = join(dir, 'default.json');

    await writeStateFile(statePath, '{"cookies":[]}');
    expect(await readFile(statePath, 'utf8')).toBe('{"cookies":[]}');
  });

  it('serializes operations on the same state path and rejects concurrent holders', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ants-toutiao-lock-'));
    tempDirs.push(dir);
    const statePath = join(dir, 'default.json');
    await writeFile(statePath, '{}');

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = withToutiaoStateLock(statePath, async () => {
      await gate;
      return 'first';
    });

    // Give the first lock a tick to acquire.
    await new Promise((resolve) => setTimeout(resolve, 20));

    await expect(withToutiaoStateLock(statePath, async () => 'second')).rejects.toMatchObject({
      code: 'TOUTIAO_LOCK_HELD',
      name: 'ToutiaoCommandError'
    } satisfies Partial<ToutiaoCommandError>);

    release();
    await expect(first).resolves.toBe('first');
  });
});
