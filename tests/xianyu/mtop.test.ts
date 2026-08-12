import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  buildSearchRequestBody,
  cookieJarFromStorageState,
  extractMtopToken,
  serializeMtopData,
  signMtopRequest,
  mtopSearchPage,
  XIANYU_MTOP_APP_KEY
} from '../../src/xianyu/mtop.js';
import type { PlaywrightStorageState } from '../../src/xianyu/storage-state.js';

describe('xianyu mtop pure API helpers', () => {
  it('signs with the classic H5 MTOP formula', () => {
    const data = serializeMtopData({ keyword: '单反', pageNumber: 1 });
    const token = 'abc123';
    const t = '1700000000000';
    const expected = createHash('md5')
      .update(`${token}&${t}&${XIANYU_MTOP_APP_KEY}&${data}`, 'utf8')
      .digest('hex');
    expect(signMtopRequest({ token, t, data })).toBe(expected);
  });

  it('extracts token from _m_h5_tk cookie', () => {
    const jar = cookieJarFromStorageState({
      cookies: [
        {
          name: '_m_h5_tk',
          value: 'deadbeef_1700000000000',
          domain: '.goofish.com',
          path: '/',
          expires: -1,
          httpOnly: false,
          secure: true,
          sameSite: 'Lax'
        }
      ],
      origins: []
    });
    expect(extractMtopToken(jar)).toBe('deadbeef');
  });

  it('builds stable search body fields', () => {
    expect(buildSearchRequestBody({ keyword: '单反', pageNumber: 2 })).toMatchObject({
      keyword: '单反',
      pageNumber: 2,
      rowsPerPage: 30,
      searchReqFromPage: 'pcSearch'
    });
  });

  it('posts signed MTOP search and returns JSON payload', async () => {
    const state: PlaywrightStorageState = {
      cookies: [
        {
          name: '_m_h5_tk',
          value: 'tok_1',
          domain: '.goofish.com',
          path: '/',
          expires: -1,
          httpOnly: false,
          secure: true,
          sameSite: 'Lax'
        },
        {
          name: 'cookie2',
          value: 'session',
          domain: '.goofish.com',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax'
        }
      ],
      origins: []
    };
    const jar = cookieJarFromStorageState(state);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toContain('mtop.taobao.idlemtopsearch.pc.search');
      expect(url).toContain('sign=');
      expect(init?.method).toBe('POST');
      expect(String(init?.headers && (init.headers as Record<string, string>).Cookie)).toContain(
        '_m_h5_tk=tok_1'
      );
      return new Response(
        JSON.stringify({
          api: 'mtop.taobao.idlemtopsearch.pc.search',
          ret: ['SUCCESS::调用成功'],
          data: {
            resultInfo: { hasNextPage: false },
            resultList: []
          }
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      );
    });

    const body = await mtopSearchPage({
      cookieJar: jar,
      keyword: '单反',
      pageNumber: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nowMs: 1700000000000
    });

    expect(body).toMatchObject({ ret: ['SUCCESS::调用成功'] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps risk-control ret to XIANYU_RISK_BLOCKED', async () => {
    const jar = cookieJarFromStorageState({
      cookies: [
        {
          name: '_m_h5_tk',
          value: 'tok_1',
          domain: '.goofish.com',
          path: '/',
          expires: -1,
          httpOnly: false,
          secure: true,
          sameSite: 'Lax'
        }
      ],
      origins: []
    });
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ret: ['RGV587_ERROR::SM::哎哟喂,被挤爆啦,请稍后重试!'],
          data: {}
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    await expect(
      mtopSearchPage({
        cookieJar: jar,
        keyword: '单反',
        pageNumber: 1,
        fetchImpl: fetchImpl as unknown as typeof fetch
      })
    ).rejects.toMatchObject({ code: 'XIANYU_RISK_BLOCKED' });
  });
});
