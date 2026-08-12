import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { searchViaApi } from '../../src/xianyu/api-search.js';

describe('searchViaApi', () => {
  it('loads storageState cookies and maps multi-page MTOP results', async () => {
    const dir = join(tmpdir(), `xianyu-api-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const statePath = join(dir, 'state.json');
    await writeFile(
      statePath,
      JSON.stringify({
        cookies: [
          {
            name: '_m_h5_tk',
            value: 'tok_99',
            domain: '.goofish.com',
            path: '/',
            expires: -1,
            httpOnly: false,
            secure: true,
            sameSite: 'Lax'
          },
          {
            name: 'cookie2',
            value: 'sess',
            domain: '.goofish.com',
            path: '/',
            expires: -1,
            httpOnly: true,
            secure: true,
            sameSite: 'Lax'
          }
        ],
        origins: []
      }),
      'utf8'
    );

    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      const itemId = String(1000 + calls);
      return new Response(
        JSON.stringify({
          ret: ['SUCCESS::调用成功'],
          data: {
            resultInfo: { hasNextPage: calls < 2 },
            resultList: [
              {
                data: {
                  item: {
                    main: {
                      exContent: {
                        itemId,
                        title: `item-${itemId}`,
                        detailParams: {
                          itemId,
                          soldPrice: String(100 * calls),
                          title: `item-${itemId}`
                        }
                      }
                    }
                  }
                }
              }
            ]
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });

    const result = await searchViaApi({
      keyword: '单反',
      pages: 2,
      statePath,
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    expect(result.meta.transport).toBe('api');
    expect(result.meta.fetchedPages).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.price).toBe('100');
    expect(result.items[1]?.price).toBe('200');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('resolves --brand via facet discovery then applies pid:vid filter', async () => {
    const dir = join(tmpdir(), `xianyu-brand-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const statePath = join(dir, 'state.json');
    await writeFile(
      statePath,
      JSON.stringify({
        cookies: [
          {
            name: '_m_h5_tk',
            value: 'tok_brand',
            domain: '.goofish.com',
            path: '/',
            expires: -1,
            httpOnly: false,
            secure: true,
            sameSite: 'Lax'
          }
        ],
        origins: []
      }),
      'utf8'
    );

    let calls = 0;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      const body = String(init?.body ?? '');
      const decoded = decodeURIComponent(body.replace(/^data=/, ''));
      if (calls === 1) {
        // facet discovery (no brand clause yet)
        expect(decoded.includes('20000:81155')).toBe(false);
        return new Response(
          JSON.stringify({
            ret: ['SUCCESS::调用成功'],
            data: {
              resultInfo: {
                hasNextPage: false,
                sqiControlFields: {
                  cpvNavigatorDo: {
                    tabList: [
                      {
                        pid: '20000',
                        pname: '品牌',
                        pvTermList: [
                          {
                            vid: '81155',
                            vname: '佳能/Canon',
                            request: { pid: 20000, vid: 81155 }
                          }
                        ]
                      }
                    ]
                  }
                }
              },
              resultList: []
            }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      // branded search
      expect(decoded.includes('20000:81155')).toBe(true);
      return new Response(
        JSON.stringify({
          ret: ['SUCCESS::调用成功'],
          data: {
            resultInfo: { hasNextPage: false },
            resultList: [
              {
                data: {
                  item: {
                    main: {
                      exContent: {
                        itemId: '9',
                        title: '佳能单反',
                        detailParams: { itemId: '9', soldPrice: '999', title: '佳能单反' }
                      }
                    }
                  }
                }
              }
            ]
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });

    const result = await searchViaApi({
      keyword: '单反',
      pages: 1,
      statePath,
      brand: '佳能',
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    expect(result.meta.brand).toEqual({
      name: '佳能/Canon',
      pid: '20000',
      vid: '81155'
    });
    expect(result.items[0]?.title).toContain('佳能');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
