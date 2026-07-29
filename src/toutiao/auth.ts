import {
  removeStateFile,
  resolveToutiaoStatePath,
  stateFileExists,
  withToutiaoStateLock
} from './state.js';
import type { ToutiaoPublishRuntime } from './publish-runtime.js';
import type { ToutiaoAuthStatusResult } from './types.js';
import { ToutiaoCommandError } from './types.js';

export interface ToutiaoAuthServiceDependencies {
  publishRuntime: ToutiaoPublishRuntime;
}

export class ToutiaoAuthService {
  constructor(private readonly dependencies: ToutiaoAuthServiceDependencies) {}

  async login(options: {
    statePath?: string;
    timeoutMs?: number;
  } = {}): Promise<ToutiaoAuthStatusResult> {
    const statePath = resolveToutiaoStatePath(options.statePath);
    return withToutiaoStateLock(statePath, async () =>
      this.dependencies.publishRuntime.loginWithQr({
        statePath,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
      })
    );
  }

  async status(options: {
    statePath?: string;
  } = {}): Promise<ToutiaoAuthStatusResult> {
    const statePath = resolveToutiaoStatePath(options.statePath);
    if (!(await stateFileExists(statePath))) {
      return {
        loggedIn: false,
        statePath
      };
    }

    return this.dependencies.publishRuntime.withAuthedSession(
      { statePath, headed: false },
      async (session) => session.getStatus()
    );
  }

  async logout(options: {
    statePath?: string;
  } = {}): Promise<ToutiaoAuthStatusResult> {
    const statePath = resolveToutiaoStatePath(options.statePath);
    const removed = await removeStateFile(statePath);
    // Best-effort remove lock leftovers if any.
    await removeStateFile(`${statePath}.lock`);

    if (!removed) {
      // Idempotent success when nothing to remove.
      return {
        loggedIn: false,
        statePath
      };
    }

    return {
      loggedIn: false,
      statePath
    };
  }
}

export function assertLoggedIn(result: ToutiaoAuthStatusResult): void {
  if (!result.loggedIn) {
    throw new ToutiaoCommandError(
      'TOUTIAO_AUTH_REQUIRED',
      'Not logged in to Toutiao creator console. Run `ants toutiao auth login` first.',
      2,
      { statePath: result.statePath }
    );
  }
}
