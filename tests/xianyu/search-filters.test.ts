import { describe, expect, it } from 'vitest';

import {
  buildExtraFilterValue,
  buildFilteredSearchRequestBody,
  buildSearchFilterString,
  parseQuickFilters,
  resolveSortPreset
} from '../../src/xianyu/search-filters.js';

describe('xianyu search filters', () => {
  it('maps sort presets to sortField/sortValue', () => {
    expect(resolveSortPreset('price_asc')).toBe('price_asc');
    expect(buildFilteredSearchRequestBody({
      keyword: '单反',
      pageNumber: 1,
      sort: 'price_asc'
    })).toMatchObject({
      fromFilter: true,
      sortField: 'price',
      sortValue: 'asc'
    });
    expect(buildFilteredSearchRequestBody({
      keyword: '单反',
      pageNumber: 1,
      sort: 'newest'
    })).toMatchObject({ sortField: 'create', sortValue: 'desc' });
  });

  it('builds price / publishDays / personal quickFilter searchFilter string', () => {
    expect(buildSearchFilterString({
      keyword: 'x',
      pageNumber: 1,
      minPrice: 500,
      maxPrice: 2000,
      publishDays: '7',
      quickFilters: ['personal', 'free_postage']
    })).toBe('priceRange:500,2000;publishDays:7;quickFilter:filterPersonal,filterFreePostage;');
  });

  it('builds location extraFilterValue JSON', () => {
    const raw = buildExtraFilterValue({
      keyword: 'x',
      pageNumber: 1,
      province: '广东',
      city: '深圳',
      area: '南山区',
      excludeMultiPlacesSellers: true
    });
    expect(JSON.parse(raw)).toEqual({
      divisionList: [{ province: '广东', city: '深圳', area: '南山区' }],
      excludeMultiPlacesSellers: '1',
      extraDivision: ''
    });
  });

  it('sets gps and distance when lat/lng provided', () => {
    const body = buildFilteredSearchRequestBody({
      keyword: '单反',
      pageNumber: 1,
      latitude: 22.54,
      longitude: 114.05,
      distanceMeters: 5000,
      sort: 'distance'
    });
    expect(body.gps).toBe('22.54,114.05');
    expect(body.customGps).toBe('22.54,114.05');
    expect(body.customDistance).toBe('5000');
    expect(body.fromFilter).toBe(true);
  });

  it('parses quick-filter csv aliases', () => {
    expect(parseQuickFilters('personal,free-postage,NEW')).toEqual([
      'personal',
      'free_postage',
      'new'
    ]);
  });

  it('rejects invalid max < min price', () => {
    expect(() => buildSearchFilterString({
      keyword: 'x',
      pageNumber: 1,
      minPrice: 100,
      maxPrice: 50
    })).toThrow(/max-price/i);
  });
});
