import {
  resolveXianyuBrowserChannel
} from './browser-channel.js';
import type { XianyuRuntime } from './runtime.js';
import type { XianyuSearchFilterOptions } from './search-filters.js';
import {
  resolveXianyuStatePath,
  withXianyuStateLock
} from './state.js';
import type { XianyuSearchResult, XianyuSearchTransport } from './types.js';
import { XianyuCommandError } from './types.js';

export class XianyuService {
  constructor(private readonly runtime: XianyuRuntime) {}

  async search(options: {
    browser?: string;
    headed?: boolean;
    keyword: string;
    pages?: number;
    statePath?: string;
    transport?: string;
    filters?: Omit<XianyuSearchFilterOptions, 'keyword' | 'pageNumber' | 'rowsPerPage'>;
    brand?: string;
    brandVid?: string;
  }): Promise<XianyuSearchResult> {
    const statePath = resolveXianyuStatePath(options.statePath);
    const browser = resolveXianyuBrowserChannel(options.browser);
    const transport = resolveTransport(options.transport);
    return withXianyuStateLock(statePath, async () =>
      this.runtime.search({
        browser,
        keyword: options.keyword,
        statePath,
        transport,
        ...(options.headed === undefined ? {} : { headed: options.headed }),
        ...(options.pages === undefined ? {} : { pages: options.pages }),
        ...(options.filters === undefined ? {} : { filters: options.filters }),
        ...(options.brand === undefined ? {} : { brand: options.brand }),
        ...(options.brandVid === undefined ? {} : { brandVid: options.brandVid })
      })
    );
  }
}

function resolveTransport(explicit?: string): XianyuSearchTransport {
  const raw = (explicit ?? 'api').trim().toLowerCase();
  if (raw === 'api' || raw === 'browser') {
    return raw;
  }
  throw new XianyuCommandError(
    'XIANYU_INVALID_INPUT',
    'Transport must be one of: api, browser.',
    2,
    { transport: explicit, supported: ['api', 'browser'] }
  );
}
