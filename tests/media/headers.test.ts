import { describe, expect, it } from 'vitest';

import {
  createBrowserHeaders,
  MEDIA_BROWSER_USER_AGENT
} from '../../src/media/headers.js';

describe('createBrowserHeaders', () => {
  it('builds a stable browser-like header set for html', () => {
    const headers = createBrowserHeaders({
      accept: 'html',
      referer: 'https://www.wired.com/',
      origin: 'https://www.wired.com'
    });

    expect(headers['User-Agent']).toBe(MEDIA_BROWSER_USER_AGENT);
    expect(headers.Accept).toContain('text/html');
    expect(headers['Sec-Fetch-Dest']).toBe('document');
    expect(headers['Sec-Fetch-Mode']).toBe('navigate');
    expect(headers.Referer).toBe('https://www.wired.com/');
    expect(headers.Origin).toBe('https://www.wired.com');
  });

  it('uses xml accept profile for feeds', () => {
    const headers = createBrowserHeaders({ accept: 'xml' });
    expect(headers.Accept).toContain('application/rss+xml');
    expect(headers['Sec-Fetch-Mode']).toBe('cors');
  });

  it('defaults accept profile to html without referer', () => {
    const headers = createBrowserHeaders();
    expect(headers.Accept).toContain('text/html');
    expect(headers['Sec-Fetch-Site']).toBe('none');
  });
});
