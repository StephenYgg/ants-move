import { describe, expect, it } from 'vitest';

import {
  buildItemUrl,
  extractPriceText,
  isMtopSuccess,
  isXianyuSearchApiUrl,
  mapSearchResponse,
  parsePriceNumber
} from '../../src/xianyu/parse.js';

describe('xianyu parse helpers', () => {
  it('detects search API urls and SUCCESS ret arrays', () => {
    expect(
      isXianyuSearchApiUrl(
        'https://h5api.m.goofish.com/h5/mtop.taobao.idlemtopsearch.pc.search/1.0/?t=1'
      )
    ).toBe(true);
    expect(isXianyuSearchApiUrl('https://example.com/other')).toBe(false);
    expect(isMtopSuccess({ ret: ['SUCCESS::调用成功'] })).toBe(true);
    expect(isMtopSuccess({ ret: ['FAIL_SYS_SESSION_EXPIRED::Session过期'] })).toBe(false);
  });

  it('extracts price text from rich segments and plain values', () => {
    expect(extractPriceText('499')).toBe('499');
    expect(extractPriceText(499)).toBe('499');
    expect(
      extractPriceText([
        { text: '¥', type: 'sign' },
        { text: '499', type: 'integer' }
      ])
    ).toBe('¥499');
    expect(parsePriceNumber('¥1,250')).toBe(1250);
    expect(parsePriceNumber('')).toBeUndefined();
  });

  it('maps resultList cards into stable search items', () => {
    const mapped = mapSearchResponse({
      ret: ['SUCCESS::调用成功'],
      data: {
        resultInfo: { hasNextPage: true },
        resultList: [
          {
            data: {
              item: {
                main: {
                  exContent: {
                    itemId: '1056439361558',
                    title: '尼康d3000数码单反套机',
                    area: '上海',
                    picUrl: 'https://img.example.com/a.jpg',
                    price: [
                      { text: '¥' },
                      { text: '499' }
                    ],
                    detailParams: {
                      itemId: '1056439361558',
                      soldPrice: '499',
                      title: '尼康d3000数码单反套机',
                      userNick: 'seller_a'
                    }
                  }
                }
              }
            }
          },
          {
            data: {
              item: {
                main: {
                  exContent: {
                    // missing itemId/title -> skipped
                    price: '1'
                  }
                }
              }
            }
          }
        ]
      }
    });

    expect(mapped.hasNextPage).toBe(true);
    expect(mapped.items).toHaveLength(1);
    expect(mapped.items[0]).toEqual({
      area: '上海',
      itemId: '1056439361558',
      picUrl: 'https://img.example.com/a.jpg',
      price: '499',
      priceNumber: 499,
      title: '尼康d3000数码单反套机',
      url: buildItemUrl('1056439361558'),
      userNick: 'seller_a'
    });
  });

  it('returns empty items for malformed payloads', () => {
    expect(mapSearchResponse(null)).toEqual({ hasNextPage: false, items: [] });
    expect(mapSearchResponse({ data: {} })).toEqual({ hasNextPage: false, items: [] });
  });
});
