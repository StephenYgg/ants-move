import { describe, expect, it, vi } from 'vitest';

import { createCli } from '../../src/index.js';
import type { XianyuRuntime } from '../../src/xianyu/runtime.js';

describe('ants xianyu command', () => {
  it('searches with injected runtime and renders JSON by default', async () => {
    let stdout = '';
    const runtime: XianyuRuntime = {
      loginWithQr: vi.fn(),
      getAuthStatus: vi.fn(),
      search: vi.fn(async () => ({
        keyword: '单反',
        items: [
          {
            itemId: '1056439361558',
            price: '499',
            priceNumber: 499,
            title: '尼康d3000',
            url: 'https://www.goofish.com/item?id=1056439361558',
            area: '上海'
          }
        ],
        meta: {
          fetchedPages: 1,
          hasNextPage: true,
          pageSize: 30,
          totalItems: 1
        }
      }))
    };
    const cli = createCli({
      xianyuRuntime: runtime,
      stderr: () => undefined,
      stdout: (value) => {
        stdout += value;
      }
    });

    const exitCode = await cli.run(['xianyu', 'search', '单反', '--pages', '1']);
    const parsed = JSON.parse(stdout) as {
      ok: boolean;
      data: { items: Array<{ itemId: string; price: string }>; keyword: string };
    };

    expect(exitCode).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.keyword).toBe('单反');
    expect(parsed.data.items[0]).toMatchObject({
      itemId: '1056439361558',
      price: '499'
    });
    expect(runtime.search).toHaveBeenCalledWith(
      expect.objectContaining({
        keyword: '单反',
        pages: 1,
        transport: 'api'
      })
    );
  });

  it('passes --transport browser to the runtime', async () => {
    const runtime: XianyuRuntime = {
      loginWithQr: vi.fn(),
      getAuthStatus: vi.fn(),
      search: vi.fn(async () => ({
        keyword: '单反',
        items: [],
        meta: {
          fetchedPages: 1,
          hasNextPage: false,
          pageSize: 30,
          totalItems: 0,
          transport: 'browser' as const
        }
      }))
    };
    const cli = createCli({
      xianyuRuntime: runtime,
      stdout: () => undefined
    });

    expect(await cli.run(['xianyu', 'search', '单反', '--transport', 'browser'])).toBe(0);
    expect(runtime.search).toHaveBeenCalledWith(
      expect.objectContaining({ transport: 'browser' })
    );
  });

  it('renders search results as a table with -t', async () => {
    let stdout = '';
    const runtime: XianyuRuntime = {
      loginWithQr: vi.fn(),
      getAuthStatus: vi.fn(),
      search: vi.fn(async () => ({
        keyword: '单反',
        items: [
          {
            itemId: '1',
            price: '100',
            title: 'camera',
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
    const cli = createCli({
      xianyuRuntime: runtime,
      stdout: (value) => {
        stdout += value;
      }
    });

    expect(await cli.run(['xianyu', 'search', '单反', '-t'])).toBe(0);
    expect(() => JSON.parse(stdout)).toThrow();
    expect(stdout).toContain('itemId');
    expect(stdout).toContain('camera');
    expect(stdout).toContain('100');
  });

  it('renders auth status JSON', async () => {
    let stdout = '';
    const runtime: XianyuRuntime = {
      loginWithQr: vi.fn(),
      getAuthStatus: vi.fn(async ({ statePath }) => ({
        loggedIn: false,
        statePath
      })),
      search: vi.fn()
    };
    const cli = createCli({
      xianyuRuntime: runtime,
      stdout: (value) => {
        stdout += value;
      }
    });

    expect(await cli.run(['xianyu', 'auth', 'status'])).toBe(0);
    const parsed = JSON.parse(stdout) as { ok: boolean; data: { loggedIn: boolean } };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.loggedIn).toBe(false);
  });

  it('renders Xianyu errors as JSON', async () => {
    let stderr = '';
    const runtime: XianyuRuntime = {
      loginWithQr: vi.fn(),
      getAuthStatus: vi.fn(),
      search: vi.fn(async () => {
        const { XianyuCommandError } = await import('../../src/xianyu/types.js');
        throw new XianyuCommandError(
          'XIANYU_AUTH_REQUIRED',
          'Xianyu auth state file is missing. Run `ants xianyu auth login` first.',
          2
        );
      })
    };
    const cli = createCli({
      xianyuRuntime: runtime,
      stderr: (value) => {
        stderr += value;
      },
      stdout: () => undefined
    });

    expect(await cli.run(['xianyu', 'search', '单反'])).toBe(2);
    expect(stderr).toContain('"code": "XIANYU_AUTH_REQUIRED"');
  });

  it('rejects invalid page arguments', async () => {
    let stderr = '';
    const cli = createCli({
      stderr: (value) => {
        stderr += value;
      },
      stdout: () => undefined
    });

    expect(await cli.run(['xianyu', 'search', '单反', '--pages', '9'])).toBe(2);
    expect(stderr).toContain('INVALID_ARGUMENT');
  });
});
