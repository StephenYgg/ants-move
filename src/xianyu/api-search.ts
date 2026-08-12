import {
  formatBrandSearchFilterClause,
  parseFacetCatalog,
  resolveBrandOption,
  type XianyuCpvOption
} from './facets.js';
import {
  isMtopSuccess,
  mapSearchResponse,
  XIANYU_MAX_ITEMS_PER_PAGE
} from './parse.js';
import { cookieJarFromStorageState, mtopSearchPage } from './mtop.js';
import type { XianyuSearchFilterOptions } from './search-filters.js';
import { readStateFile, stateFileExists } from './state.js';
import { parseAndSanitizeStorageState } from './storage-state.js';
import type { XianyuSearchItem, XianyuSearchResult } from './types.js';
import { XianyuCommandError } from './types.js';

const MAX_SEARCH_PAGES = 5;
const MAX_RETAINED_BYTES = 5 * 1024 * 1024;

export async function searchViaApi(options: {
  keyword: string;
  pages?: number;
  statePath: string;
  filters?: Omit<XianyuSearchFilterOptions, 'keyword' | 'pageNumber' | 'rowsPerPage'>;
  brand?: string;
  brandVid?: string;
  fetchImpl?: typeof fetch;
}): Promise<XianyuSearchResult> {
  const keyword = options.keyword.trim();
  if (!keyword) {
    throw new XianyuCommandError(
      'XIANYU_INVALID_INPUT',
      'Search keyword must not be empty.',
      2
    );
  }
  const pageLimit = normalizePages(options.pages);
  if (!(await stateFileExists(options.statePath))) {
    throw new XianyuCommandError(
      'XIANYU_AUTH_REQUIRED',
      'Xianyu auth state file is missing. Run `ants xianyu auth login` first.',
      2,
      { statePath: options.statePath }
    );
  }

  const storageState = parseAndSanitizeStorageState(await readStateFile(options.statePath));
  const cookieJar = cookieJarFromStorageState(storageState);
  const fetchOpts =
    options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl };

  let filters = { ...(options.filters ?? {}) };
  let appliedBrand: XianyuCpvOption | undefined;

  if (options.brand || options.brandVid) {
    // Facet discovery search (without brand clause) to resolve name → pid/vid.
    const facetPayload = await mtopSearchPage({
      cookieJar,
      keyword,
      pageNumber: 1,
      filters,
      ...fetchOpts
    });
    assertSuccess(facetPayload);
    const catalog = parseFacetCatalog(facetPayload);
    if (catalog.brands.length === 0) {
      throw new XianyuCommandError(
        'XIANYU_BRAND_NOT_FOUND',
        'No brand facets were returned for this keyword. Try a broader keyword or omit --brand.',
        2,
        { keyword }
      );
    }
    appliedBrand = resolveBrandOption({
      catalog,
      ...(options.brand === undefined ? {} : { brand: options.brand }),
      ...(options.brandVid === undefined ? {} : { brandVid: options.brandVid })
    });
    filters = {
      ...filters,
      brandFilterClause: formatBrandSearchFilterClause(appliedBrand)
    };
  }

  const items: XianyuSearchItem[] = [];
  let hasNextPage = false;
  let fetchedPages = 0;
  let retainedBytes = 0;

  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const payload = await mtopSearchPage({
      cookieJar,
      keyword,
      pageNumber,
      filters,
      ...fetchOpts
    });
    assertSuccess(payload);

    const mapped = mapSearchResponse(payload);
    const existing = new Set(items.map((item) => item.itemId));
    const fresh = mapped.items.filter((item) => !existing.has(item.itemId));
    retainedBytes = addRetainedBytes(retainedBytes, fresh);
    items.push(...fresh);
    hasNextPage = mapped.hasNextPage;
    fetchedPages = pageNumber;

    if (!hasNextPage || fresh.length === 0) {
      hasNextPage = mapped.hasNextPage && fresh.length > 0;
      break;
    }
  }

  return {
    keyword,
    items,
    meta: {
      fetchedPages,
      hasNextPage,
      pageSize: XIANYU_MAX_ITEMS_PER_PAGE,
      totalItems: items.length,
      transport: 'api',
      ...(appliedBrand
        ? {
            brand: {
              name: appliedBrand.vname,
              pid: appliedBrand.pid,
              vid: appliedBrand.vid
            }
          }
        : {})
    }
  };
}

function assertSuccess(payload: unknown): void {
  if (!isMtopSuccess(payload)) {
    throw new XianyuCommandError(
      'XIANYU_SEARCH_FAILED',
      'Xianyu pure API search did not return SUCCESS.',
      2,
      {
        ret:
          payload && typeof payload === 'object'
            ? (payload as { ret?: unknown }).ret
            : undefined
      }
    );
  }
}

function normalizePages(pages: number | undefined): number {
  const value = pages ?? 1;
  if (!Number.isInteger(value) || value < 1 || value > MAX_SEARCH_PAGES) {
    throw new XianyuCommandError(
      'XIANYU_INVALID_PAGES',
      `Xianyu search pages must be an integer between 1 and ${MAX_SEARCH_PAGES}.`,
      2,
      { pages: value, maxPages: MAX_SEARCH_PAGES }
    );
  }
  return value;
}

function addRetainedBytes(retainedBytes: number, items: XianyuSearchItem[]): number {
  const next = retainedBytes + Buffer.byteLength(JSON.stringify(items), 'utf8');
  if (next > MAX_RETAINED_BYTES) {
    throw new XianyuCommandError(
      'XIANYU_RESOURCE_LIMIT',
      'Xianyu search results exceeded the configured size limit.',
      2,
      {
        maxRetainedBytes: MAX_RETAINED_BYTES,
        retainedBytes: next
      }
    );
  }
  return next;
}
