import { describe, expect, it } from 'vitest';

import {
  buildCdpUrl,
  resolveBrowserMetaPath,
  resolveManagedProfilePath
} from '../../src/toutiao/managed-browser.js';

describe('managed browser helpers', () => {
  it('builds loopback CDP URLs', () => {
    expect(buildCdpUrl(9222)).toBe('http://127.0.0.1:9222');
  });

  it('resolves default profile and meta paths under the user home config', () => {
    expect(resolveManagedProfilePath()).toContain('.config/ants-move/toutiao/chrome-profile');
    expect(resolveBrowserMetaPath()).toContain('.config/ants-move/toutiao/browser.json');
  });

  it('resolves explicit absolute paths', () => {
    expect(resolveManagedProfilePath('/tmp/ants-profile')).toBe('/tmp/ants-profile');
    expect(resolveBrowserMetaPath('/tmp/browser.json')).toBe('/tmp/browser.json');
  });
});
