import { XianyuCommandError } from './types.js';

export interface XianyuCpvOption {
  pid: string;
  pname: string;
  vid: string;
  vname: string;
  idleCateId?: string;
}

export interface XianyuFacetCatalog {
  brands: XianyuCpvOption[];
  /** Other CPV tabs (成色 / 功能状态 / …) for future flags. */
  tabs: Array<{ pid: string; pname: string; options: XianyuCpvOption[] }>;
}

/**
 * Parse brand / CPV navigator facet from a successful search response.
 */
export function parseFacetCatalog(body: unknown): XianyuFacetCatalog {
  const tabsRaw = digCpvTabList(body);
  const tabs: XianyuFacetCatalog['tabs'] = [];
  const brands: XianyuCpvOption[] = [];

  for (const tab of tabsRaw) {
    if (!tab || typeof tab !== 'object') {
      continue;
    }
    const record = tab as Record<string, unknown>;
    const pid = String(record.pid ?? '').trim();
    const pname = String(record.pname ?? '').trim();
    const terms = Array.isArray(record.pvTermList) ? record.pvTermList : [];
    const options: XianyuCpvOption[] = [];
    for (const term of terms) {
      if (!term || typeof term !== 'object') {
        continue;
      }
      const t = term as Record<string, unknown>;
      const vid = String(t.vid ?? '').trim();
      const vname = String(t.vname ?? '').trim();
      if (!pid || !vid || !vname) {
        continue;
      }
      const request =
        t.request && typeof t.request === 'object'
          ? (t.request as Record<string, unknown>)
          : {};
      const option: XianyuCpvOption = {
        pid: String(request.pid ?? pid),
        pname: pname || String(request.pname ?? ''),
        vid: String(request.vid ?? vid),
        vname
      };
      if (request.idleCateId !== undefined && request.idleCateId !== null) {
        option.idleCateId = String(request.idleCateId);
      }
      options.push(option);
    }
    if (!pid || options.length === 0) {
      continue;
    }
    tabs.push({ pid, pname, options });
    if (pname === '品牌' || pid === '20000') {
      brands.push(...options);
    }
  }

  // Fallback: if no tab named 品牌, use first tab with many options as brands.
  if (brands.length === 0 && tabs[0]) {
    brands.push(...tabs[0].options);
  }

  return { brands, tabs };
}

export function resolveBrandOption(options: {
  brand?: string;
  brandVid?: string;
  catalog: XianyuFacetCatalog;
}): XianyuCpvOption {
  const { brand, brandVid, catalog } = options;
  if (!brand && !brandVid) {
    throw new XianyuCommandError(
      'XIANYU_INVALID_INPUT',
      'Brand resolution requires --brand or --brand-vid.',
      2
    );
  }

  if (brandVid) {
    const byVid = catalog.brands.find((item) => item.vid === brandVid.trim());
    if (!byVid) {
      throw brandNotFoundError(brandVid, catalog, 'vid');
    }
    return byVid;
  }

  const query = normalizeBrandQuery(brand ?? '');
  if (!query) {
    throw new XianyuCommandError(
      'XIANYU_INVALID_INPUT',
      '--brand must not be empty.',
      2
    );
  }

  const exact = catalog.brands.find((item) => {
    const names = splitBrandNames(item.vname).map(normalizeBrandQuery);
    return names.includes(query) || normalizeBrandQuery(item.vname) === query;
  });
  if (exact) {
    return exact;
  }

  const partial = catalog.brands.filter((item) => {
    const names = splitBrandNames(item.vname).map(normalizeBrandQuery);
    const full = normalizeBrandQuery(item.vname);
    return full.includes(query) || names.some((name) => name.includes(query) || query.includes(name));
  });
  if (partial.length === 1) {
    return partial[0]!;
  }
  if (partial.length > 1) {
    throw new XianyuCommandError(
      'XIANYU_BRAND_AMBIGUOUS',
      `Brand "${brand}" matches multiple options. Use a more specific name or --brand-vid.`,
      2,
      {
        brand,
        matches: partial.slice(0, 20).map((item) => ({
          vname: item.vname,
          vid: item.vid,
          pid: item.pid
        }))
      }
    );
  }

  throw brandNotFoundError(brand ?? '', catalog, 'name');
}

export function formatBrandSearchFilterClause(option: XianyuCpvOption): string {
  // PC searchFilter encodes selected CPV as "pid:vid;"
  return `${option.pid}:${option.vid};`;
}

function digCpvTabList(body: unknown): unknown[] {
  if (!body || typeof body !== 'object') {
    return [];
  }
  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== 'object') {
    return [];
  }
  const resultInfo = (data as { resultInfo?: unknown }).resultInfo;
  if (!resultInfo || typeof resultInfo !== 'object') {
    return [];
  }
  const sqi = (resultInfo as { sqiControlFields?: unknown }).sqiControlFields;
  if (!sqi || typeof sqi !== 'object') {
    return [];
  }
  const nav = (sqi as { cpvNavigatorDo?: unknown }).cpvNavigatorDo;
  if (!nav || typeof nav !== 'object') {
    return [];
  }
  const tabList = (nav as { tabList?: unknown }).tabList;
  return Array.isArray(tabList) ? tabList : [];
}

function splitBrandNames(vname: string): string[] {
  return vname
    .split(/[\/\uFF0F|｜]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeBrandQuery(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[·•.]/g, '');
}

function brandNotFoundError(
  query: string,
  catalog: XianyuFacetCatalog,
  kind: 'name' | 'vid'
): XianyuCommandError {
  return new XianyuCommandError(
    'XIANYU_BRAND_NOT_FOUND',
    kind === 'vid'
      ? `Brand vid "${query}" was not found in facets for this keyword.`
      : `Brand "${query}" was not found in facets for this keyword.`,
    2,
    {
      query,
      availableBrands: catalog.brands.slice(0, 40).map((item) => ({
        vname: item.vname,
        vid: item.vid,
        pid: item.pid
      }))
    }
  );
}
