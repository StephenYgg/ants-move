import {
  resolveToutiaoBrowserChannel
} from './browser-channel.js';
import {
  removeStateFile,
  resolveToutiaoStatePath,
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
    browser?: string;
    cdpUrl?: string;
    statePath?: string;
    timeoutMs?: number;
  } = {}): Promise<ToutiaoAuthStatusResult> {
    const statePath = resolveToutiaoStatePath(options.statePath);
    const browser = resolveToutiaoBrowserChannel(options.browser);
    return withToutiaoStateLock(statePath, async () =>
      this.dependencies.publishRuntime.loginWithQr({
        browser,
        statePath,
        ...(options.cdpUrl === undefined ? {} : { cdpUrl: options.cdpUrl }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
      })
    );
  }

  async status(options: {
    browser?: string;
    cdpUrl?: string;
    statePath?: string;
  } = {}): Promise<ToutiaoAuthStatusResult> {
    const statePath = resolveToutiaoStatePath(options.statePath);
    const browser = resolveToutiaoBrowserChannel(options.browser);

    try {
      return await this.dependencies.publishRuntime.withAuthedSession(
        {
          browser,
          statePath,
          headed: false,
          ...(options.cdpUrl === undefined ? {} : { cdpUrl: options.cdpUrl })
        },
        async (session) => session.getStatus()
      );
    } catch (error) {
      if (
        error instanceof ToutiaoCommandError
        && (
          error.code === 'TOUTIAO_AUTH_REQUIRED'
          || error.code === 'TOUTIAO_AUTH_EXPIRED'
          || error.code === 'TOUTIAO_CDP_UNAVAILABLE'
          || error.code === 'TOUTIAO_BROWSER_UNAVAILABLE'
        )
      ) {
        return {
          loggedIn: false,
          statePath
        };
      }
      throw error;
    }
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
