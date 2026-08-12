import { describe, expect, it } from 'vitest';

import {
  formatBrandSearchFilterClause,
  parseFacetCatalog,
  resolveBrandOption
} from '../../src/xianyu/facets.js';
import { buildSearchFilterString } from '../../src/xianyu/search-filters.js';

const sampleBody = {
  ret: ['SUCCESS::调用成功'],
  data: {
    resultInfo: {
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
                  request: { pid: 20000, vid: 81155, idleCateId: 127154005 }
                },
                {
                  vid: '21465',
                  vname: '尼康/Nikon',
                  request: { pid: 20000, vid: 21465, idleCateId: 127154005 }
                },
                {
                  vid: '10752',
                  vname: '索尼/Sony',
                  request: { pid: 20000, vid: 10752 }
                }
              ]
            },
            {
              pid: '20879',
              pname: '成色',
              pvTermList: [
                { vid: '21456', vname: '全新', request: { pid: 20879, vid: 21456 } }
              ]
            }
          ]
        }
      }
    }
  }
};

describe('xianyu brand facets', () => {
  it('parses brand options from cpvNavigatorDo', () => {
    const catalog = parseFacetCatalog(sampleBody);
    expect(catalog.brands).toHaveLength(3);
    expect(catalog.brands[0]).toMatchObject({
      pid: '20000',
      vid: '81155',
      vname: '佳能/Canon',
      idleCateId: '127154005'
    });
    expect(catalog.tabs.map((tab) => tab.pname)).toEqual(['品牌', '成色']);
  });

  it('resolves brand by Chinese or English name', () => {
    const catalog = parseFacetCatalog(sampleBody);
    expect(resolveBrandOption({ brand: '佳能', catalog }).vid).toBe('81155');
    expect(resolveBrandOption({ brand: 'canon', catalog }).vid).toBe('81155');
    expect(resolveBrandOption({ brand: 'Nikon', catalog }).vid).toBe('21465');
    expect(resolveBrandOption({ brandVid: '10752', catalog }).vname).toContain('索尼');
  });

  it('builds searchFilter brand clause with price filter', () => {
    const catalog = parseFacetCatalog(sampleBody);
    const brand = resolveBrandOption({ brand: '佳能', catalog });
    const clause = formatBrandSearchFilterClause(brand);
    expect(clause).toBe('20000:81155;');
    expect(buildSearchFilterString({
      keyword: '单反',
      pageNumber: 1,
      minPrice: 500,
      maxPrice: 2000,
      brandFilterClause: clause
    })).toBe('priceRange:500,2000;20000:81155;');
  });

  it('errors with available brands when name is unknown', () => {
    const catalog = parseFacetCatalog(sampleBody);
    expect(() => resolveBrandOption({ brand: '不存在的牌子', catalog }))
      .toThrow(/not found/i);
  });
});
