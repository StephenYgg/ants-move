import type { XianyuSearchRequestBody } from './mtop.js';
import { XianyuCommandError } from './types.js';

/** Sort presets exposed on the CLI. */
export type XianyuSortPreset =
  | 'default'
  | 'price_asc'
  | 'price_desc'
  | 'newest'
  | 'oldest'
  | 'distance'
  | 'credit';

export type XianyuPublishDays = '1' | '3' | '7' | '14';

/**
 * Quick filters mirrored from PC search UI / reverse-engineered clients.
 * Values are the platform `quickFilter:` tokens.
 */
export const XIANYU_QUICK_FILTERS = {
  personal: 'filterPersonal',
  free_postage: 'filterFreePostage',
  new: 'filterNew',
  appraise: 'filterAppraise',
  high_level_seller: 'filterHighLevelYxpSeller',
  inspected: 'inspectedPhone',
  resell: 'filterOneKeyResell',
  game_account: 'gameAccountInsurance'
} as const;

export type XianyuQuickFilterKey = keyof typeof XIANYU_QUICK_FILTERS;

export interface XianyuSearchFilterOptions {
  keyword: string;
  pageNumber: number;
  rowsPerPage?: number;
  sort?: XianyuSortPreset;
  minPrice?: number;
  maxPrice?: number;
  publishDays?: XianyuPublishDays;
  quickFilters?: XianyuQuickFilterKey[];
  province?: string;
  city?: string;
  area?: string;
  excludeMultiPlacesSellers?: boolean;
  latitude?: number;
  longitude?: number;
  /** Distance in meters (customDistance). */
  distanceMeters?: number;
  /**
   * Resolved CPV brand clause already formatted as `pid:vid;`
   * (appended into propValueStr.searchFilter).
   */
  brandFilterClause?: string;
}

const SORT_MAP: Record<XianyuSortPreset, { sortField: string; sortValue: string }> = {
  default: { sortField: '', sortValue: '' },
  price_asc: { sortField: 'price', sortValue: 'asc' },
  price_desc: { sortField: 'price', sortValue: 'desc' },
  newest: { sortField: 'create', sortValue: 'desc' },
  oldest: { sortField: 'create', sortValue: 'asc' },
  distance: { sortField: 'pos', sortValue: 'asc' },
  credit: { sortField: 'credit', sortValue: 'desc' }
};

export function resolveSortPreset(raw?: string): XianyuSortPreset {
  if (raw === undefined || raw.trim() === '') {
    return 'default';
  }
  const key = raw.trim().toLowerCase().replace(/-/g, '_');
  if (key in SORT_MAP) {
    return key as XianyuSortPreset;
  }
  throw new XianyuCommandError(
    'XIANYU_INVALID_INPUT',
    'Invalid --sort. Use: default, price_asc, price_desc, newest, oldest, distance, credit.',
    2,
    { sort: raw, supported: Object.keys(SORT_MAP) }
  );
}

export function parseQuickFilters(raw?: string): XianyuQuickFilterKey[] {
  if (raw === undefined || raw.trim() === '') {
    return [];
  }
  const keys = raw
    .split(',')
    .map((part) => part.trim().toLowerCase().replace(/-/g, '_'))
    .filter(Boolean);
  const out: XianyuQuickFilterKey[] = [];
  for (const key of keys) {
    if (!(key in XIANYU_QUICK_FILTERS)) {
      throw new XianyuCommandError(
        'XIANYU_INVALID_INPUT',
        `Unknown quick filter "${key}". Supported: ${Object.keys(XIANYU_QUICK_FILTERS).join(', ')}.`,
        2,
        { quickFilter: key, supported: Object.keys(XIANYU_QUICK_FILTERS) }
      );
    }
    if (!out.includes(key as XianyuQuickFilterKey)) {
      out.push(key as XianyuQuickFilterKey);
    }
  }
  return out;
}

export function parsePublishDays(raw?: string): XianyuPublishDays | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const value = raw.trim();
  if (value === '1' || value === '3' || value === '7' || value === '14') {
    return value;
  }
  throw new XianyuCommandError(
    'XIANYU_INVALID_INPUT',
    'Invalid --publish-days. Use 1, 3, 7, or 14.',
    2,
    { publishDays: raw }
  );
}

export function parseNonNegativeNumber(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new XianyuCommandError(
      'XIANYU_INVALID_INPUT',
      `${flag} must be a non-negative number.`,
      2,
      { [flag]: raw }
    );
  }
  return value;
}

/**
 * Build PC MTOP search `data` body including advanced filters.
 * Protocol aligned with reverse-engineered goofish PC search clients.
 */
export function buildFilteredSearchRequestBody(
  options: XianyuSearchFilterOptions
): XianyuSearchRequestBody {
  const sort = SORT_MAP[options.sort ?? 'default'];
  const searchFilter = buildSearchFilterString(options);
  const extraFilterValue = buildExtraFilterValue(options);
  const userPositionJson = buildUserPositionJson(options);
  const gps = buildGpsString(options);
  const hasFilter = Boolean(
    (options.sort && options.sort !== 'default')
    || searchFilter
    || extraFilterValue !== '{}'
    || userPositionJson !== '{}'
    || gps
    || options.distanceMeters !== undefined
    || options.brandFilterClause
  );

  const propValueStr: Record<string, unknown> = searchFilter
    ? { searchFilter }
    : {};

  return {
    pageNumber: options.pageNumber,
    keyword: options.keyword,
    fromFilter: hasFilter,
    rowsPerPage: options.rowsPerPage ?? 30,
    sortValue: sort.sortValue,
    sortField: sort.sortField,
    customDistance:
      options.distanceMeters === undefined ? '' : String(Math.round(options.distanceMeters)),
    gps,
    propValueStr,
    customGps: gps,
    searchReqFromPage: 'pcSearch',
    extraFilterValue,
    userPositionJson
  };
}

export function buildSearchFilterString(options: XianyuSearchFilterOptions): string {
  const parts: string[] = [];

  if (options.minPrice !== undefined || options.maxPrice !== undefined) {
    const from = options.minPrice ?? 0;
    const to = options.maxPrice === undefined ? '' : String(options.maxPrice);
    if (options.maxPrice !== undefined && options.minPrice !== undefined
      && options.maxPrice < options.minPrice) {
      throw new XianyuCommandError(
        'XIANYU_INVALID_INPUT',
        '--max-price must be greater than or equal to --min-price.',
        2,
        { minPrice: options.minPrice, maxPrice: options.maxPrice }
      );
    }
    parts.push(`priceRange:${from},${to}`);
  }

  if (options.publishDays) {
    parts.push(`publishDays:${options.publishDays}`);
  }

  if (options.quickFilters && options.quickFilters.length > 0) {
    const tokens = options.quickFilters.map((key) => XIANYU_QUICK_FILTERS[key]);
    parts.push(`quickFilter:${tokens.join(',')}`);
  }

  if (options.brandFilterClause) {
    const clause = options.brandFilterClause.endsWith(';')
      ? options.brandFilterClause
      : `${options.brandFilterClause};`;
    // Brand CPV is encoded as bare "pid:vid;" inside searchFilter.
    parts.push(clause.replace(/;$/, ''));
  }

  // Platform expects each clause terminated with ';'
  return parts.map((part) => `${part};`).join('');
}

export function buildExtraFilterValue(options: XianyuSearchFilterOptions): string {
  const hasDivision = Boolean(options.province || options.city || options.area);
  if (!hasDivision && !options.excludeMultiPlacesSellers) {
    return '{}';
  }

  const division: Record<string, string> = {};
  if (options.province) {
    division.province = options.province;
  }
  if (options.city) {
    division.city = options.city;
  }
  if (options.area) {
    division.area = options.area;
  }

  return JSON.stringify({
    divisionList: hasDivision ? [division] : [],
    excludeMultiPlacesSellers: options.excludeMultiPlacesSellers ? '1' : '0',
    extraDivision: ''
  });
}

export function buildUserPositionJson(options: XianyuSearchFilterOptions): string {
  // Optional: when province+city given, also pass as userPosition for distance-ish ranking.
  if (!options.province || !options.city) {
    return '{}';
  }
  const pos: Record<string, string> = {
    province: options.province,
    city: options.city
  };
  if (options.area) {
    pos.district = options.area;
  }
  return JSON.stringify(pos);
}

export function buildGpsString(options: XianyuSearchFilterOptions): string {
  if (options.latitude === undefined || options.longitude === undefined) {
    if (options.latitude !== undefined || options.longitude !== undefined) {
      throw new XianyuCommandError(
        'XIANYU_INVALID_INPUT',
        '--lat and --lng must be provided together.',
        2
      );
    }
    return '';
  }
  return `${options.latitude},${options.longitude}`;
}
