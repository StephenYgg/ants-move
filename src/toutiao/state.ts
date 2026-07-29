import { closeSync, constants, mkdirSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { chmod, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

import { ToutiaoCommandError } from './types.js';

export const DEFAULT_TOUTIAO_STATE_RELATIVE_PATH = '.config/ants-move/toutiao/default.json';
const LOCK_STALE_MS = 30 * 60 * 1000;

export function resolveToutiaoStatePath(explicit?: string): string {
  if (explicit !== undefined && explicit.trim() !== '') {
    return resolve(explicit.trim());
  }

  return resolve(homedir(), DEFAULT_TOUTIAO_STATE_RELATIVE_PATH);
}

export function lockPathForState(statePath: string): string {
  return `${statePath}.lock`;
}

export async function ensureStateDirectory(statePath: string): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
}

export async function stateFileExists(statePath: string): Promise<boolean> {
  try {
    const info = await stat(statePath);
    return info.isFile();
  } catch {
    return false;
  }
}

export async function readStateFile(statePath: string): Promise<string> {
  try {
    return await readFile(statePath, 'utf8');
  } catch {
    throw new ToutiaoCommandError(
      'TOUTIAO_AUTH_REQUIRED',
      'Toutiao auth state file is missing. Run `ants toutiao auth login` first.',
      2,
      { statePath }
    );
  }
}

export async function writeStateFile(statePath: string, contents: string): Promise<void> {
  await ensureStateDirectory(statePath);
  await writeFile(statePath, contents, { mode: 0o600 });
  await chmod(statePath, 0o600);
}

export async function removeStateFile(statePath: string): Promise<boolean> {
  try {
    await unlink(statePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Exclusive lock for one state path. Prevents concurrent publish/login on the same account file.
 * Fail-fast if another process holds a non-stale lock.
 */
export async function withToutiaoStateLock<T>(
  statePath: string,
  operation: () => Promise<T>
): Promise<T> {
  const lockPath = lockPathForState(statePath);
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });

  let fd: number;
  try {
    fd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      if (await isLockStale(lockPath)) {
        try {
          unlinkSync(lockPath);
        } catch {
          // Another process may have reclaimed the lock.
        }
        try {
          fd = openSync(
            lockPath,
            constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
            0o600
          );
        } catch {
          throw lockHeldError(statePath, lockPath);
        }
      } else {
        throw lockHeldError(statePath, lockPath);
      }
    } else {
      throw error;
    }
  }

  try {
    writeFileSync(fd, `${process.pid}\n${Date.now()}\n`, 'utf8');
    return await operation();
  } finally {
    closeSync(fd);
    try {
      unlinkSync(lockPath);
    } catch {
      // Best-effort unlock.
    }
  }
}

async function isLockStale(lockPath: string): Promise<boolean> {
  try {
    const info = await stat(lockPath);
    return Date.now() - info.mtimeMs > LOCK_STALE_MS;
  } catch {
    return true;
  }
}

function lockHeldError(statePath: string, lockPath: string): ToutiaoCommandError {
  return new ToutiaoCommandError(
    'TOUTIAO_LOCK_HELD',
    'Another ants-move process is using this Toutiao auth state. Retry after it finishes.',
    1,
    { lockPath, statePath }
  );
}
