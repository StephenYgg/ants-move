import { describe, expect, it, vi } from 'vitest';

import { XianyuAuthService } from '../../src/xianyu/auth.js';
import { XianyuService } from '../../src/xianyu/service.js';
import type { XianyuRuntime } from '../../src/xianyu/runtime.js';
import { XianyuCommandError } from '../../src/xianyu/types.js';

describe('XianyuService / XianyuAuthService', () => {
  it('delegates search through the state lock path with resolved options', async () => {
    const runtime: XianyuRuntime = {
      loginWithQr: vi.fn(),
      getAuthStatus: vi.fn(),
      search: vi.fn(async () => ({
        keyword: '单反',
        items: [
          {
            itemId: '1',
            price: '100',
            priceNumber: 100,
            title: 'item',
            url: 'https://www.goofish.com/item?id=1'
          }
        ],
        meta: {
          fetchedPages: 1,
          hasNextPage: false,
          pageSize: 30,
          totalItems: 1
        }
      }))
    };
    const service = new XianyuService(runtime);
    const result = await service.search({
      keyword: '单反',
      pages: 1,
      browser: 'chromium',
      statePath: '/tmp/xianyu-state-test.json'
    });

    expect(result.meta.totalItems).toBe(1);
    expect(runtime.search).toHaveBeenCalledWith(
      expect.objectContaining({
        browser: 'chromium',
        keyword: '单反',
        pages: 1,
        statePath: '/tmp/xianyu-state-test.json',
        transport: 'api'
      })
    );
  });

  it('rejects invalid browser channels before calling runtime', async () => {
    const runtime: XianyuRuntime = {
      loginWithQr: vi.fn(),
      getAuthStatus: vi.fn(),
      search: vi.fn()
    };
    const service = new XianyuService(runtime);
    await expect(
      service.search({ keyword: '单反', browser: 'firefox' })
    ).rejects.toMatchObject({ code: 'XIANYU_INVALID_INPUT' });
    expect(runtime.search).not.toHaveBeenCalled();
  });

  it('login/status/logout return auth envelopes', async () => {
    const runtime: XianyuRuntime = {
      loginWithQr: vi.fn(async ({ statePath }) => ({
        loggedIn: true,
        statePath,
        account: { nick: 'tester' }
      })),
      getAuthStatus: vi.fn(async ({ statePath }) => ({
        loggedIn: true,
        statePath,
        account: { nick: 'tester' }
      })),
      search: vi.fn()
    };
    const auth = new XianyuAuthService(runtime);
    const statePath = '/tmp/xianyu-auth-test.json';

    await expect(auth.login({ statePath, browser: 'chrome', timeoutMs: 1000 }))
      .resolves.toMatchObject({ loggedIn: true, account: { nick: 'tester' } });
    await expect(auth.status({ statePath })).resolves.toMatchObject({ loggedIn: true });
    await expect(auth.logout({ statePath })).resolves.toMatchObject({
      loggedIn: false,
      statePath
    });
  });

  it('surfaces runtime command errors unchanged', async () => {
    const runtime: XianyuRuntime = {
      loginWithQr: vi.fn(),
      getAuthStatus: vi.fn(),
      search: vi.fn(async () => {
        throw new XianyuCommandError('XIANYU_AUTH_REQUIRED', 'missing', 2);
      })
    };
    const service = new XianyuService(runtime);
    await expect(service.search({ keyword: '单反', statePath: '/tmp/a.json' }))
      .rejects.toMatchObject({ code: 'XIANYU_AUTH_REQUIRED', exitCode: 2 });
  });
});
