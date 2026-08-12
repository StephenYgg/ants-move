import {
  resolveXianyuBrowserChannel
} from './browser-channel.js';
import type { XianyuRuntime } from './runtime.js';
import {
  removeStateFile,
  resolveXianyuStatePath,
  withXianyuStateLock
} from './state.js';
import type { XianyuAuthStatusResult } from './types.js';

export class XianyuAuthService {
  constructor(private readonly runtime: XianyuRuntime) {}

  async login(options: {
    browser?: string;
    statePath?: string;
    timeoutMs?: number;
  } = {}): Promise<XianyuAuthStatusResult> {
    const statePath = resolveXianyuStatePath(options.statePath);
    const browser = resolveXianyuBrowserChannel(options.browser);
    return withXianyuStateLock(statePath, async () =>
      this.runtime.loginWithQr({
        browser,
        statePath,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
      })
    );
  }

  async status(options: {
    browser?: string;
    headed?: boolean;
    statePath?: string;
  } = {}): Promise<XianyuAuthStatusResult> {
    const statePath = resolveXianyuStatePath(options.statePath);
    const browser = resolveXianyuBrowserChannel(options.browser);
    return this.runtime.getAuthStatus({
      browser,
      statePath,
      ...(options.headed === undefined ? {} : { headed: options.headed })
    });
  }

  async logout(options: {
    statePath?: string;
  } = {}): Promise<XianyuAuthStatusResult> {
    const statePath = resolveXianyuStatePath(options.statePath);
    await removeStateFile(statePath);
    return {
      loggedIn: false,
      statePath
    };
  }
}
