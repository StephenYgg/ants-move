export type XianyuBrowserChannel = 'chrome' | 'msedge' | 'chromium';

/** How search traffic is collected. */
export type XianyuSearchTransport = 'api' | 'browser';

export interface XianyuAuthStatusResult {
  account?: {
    nick?: string;
  };
  loggedIn: boolean;
  statePath: string;
}

export interface XianyuSearchItem {
  area?: string;
  itemId: string;
  picUrl?: string;
  price: string;
  priceNumber?: number;
  title: string;
  url: string;
  userNick?: string;
}

export interface XianyuSearchResult {
  items: XianyuSearchItem[];
  keyword: string;
  meta: {
    fetchedPages: number;
    hasNextPage: boolean;
    pageSize: number;
    totalItems: number;
    /** Present on pure-API and browser search results. */
    transport?: XianyuSearchTransport;
    /** Resolved brand facet when --brand / --brand-vid was used. */
    brand?: {
      name: string;
      pid: string;
      vid: string;
    };
  };
}

export class XianyuCommandError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly exitCode: number,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'XianyuCommandError';
  }
}
