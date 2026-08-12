export type MediaAcceptProfile = 'html' | 'json' | 'xml';

export interface BrowserHeaderOptions {
  accept?: MediaAcceptProfile;
  origin?: string;
  referer?: string;
  secFetchSite?: 'none' | 'same-origin' | 'same-site' | 'cross-site';
}

/** Stable Chrome desktop profile — do not randomize per request. */
export const MEDIA_BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const ACCEPT_BY_PROFILE: Record<MediaAcceptProfile, string> = {
  html: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  json: 'application/json,text/plain,*/*;q=0.8',
  xml: 'application/rss+xml,application/atom+xml,application/xml;q=0.9,text/xml;q=0.8,*/*;q=0.7'
};

/**
 * Build browser-like request headers for media collectors.
 * Prefer a fixed realistic UA plus full Sec-Fetch / Accept stack over bare Node defaults.
 */
export function createBrowserHeaders(
  options: BrowserHeaderOptions = {}
): Record<string, string> {
  const accept = options.accept ?? 'html';
  const secFetchSite = options.secFetchSite ?? (options.referer ? 'same-origin' : 'none');
  const headers: Record<string, string> = {
    Accept: ACCEPT_BY_PROFILE[accept],
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'Sec-Fetch-Dest': accept === 'html' ? 'document' : 'empty',
    'Sec-Fetch-Mode': accept === 'html' ? 'navigate' : 'cors',
    'Sec-Fetch-Site': secFetchSite,
    'User-Agent': MEDIA_BROWSER_USER_AGENT
  };

  if (accept === 'html') {
    headers['Sec-Fetch-User'] = '?1';
    headers['Upgrade-Insecure-Requests'] = '1';
  }

  if (options.referer) {
    headers.Referer = options.referer;
  }

  if (options.origin) {
    headers.Origin = options.origin;
  }

  return headers;
}

export function originFromUrl(url: string): string {
  const parsed = new URL(url);
  return parsed.origin;
}

export function siteRootReferer(url: string): string {
  return `${originFromUrl(url)}/`;
}
