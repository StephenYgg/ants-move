import { describe, expect, it, vi } from 'vitest';

import {
  grantCreatorSitePermissions,
  textToEditorHtml,
  TOUTIAO_SITE_PERMISSIONS
} from '../../src/toutiao/publisher/browser-helpers.js';

describe('textToEditorHtml', () => {
  it('escapes HTML and converts paragraphs', () => {
    expect(textToEditorHtml('a <b> & c\n\nsecond')).toBe(
      '<p>a &lt;b&gt; &amp; c</p><p>second</p>'
    );
  });
});

describe('grantCreatorSitePermissions', () => {
  it('grants all site permissions for Toutiao origins', async () => {
    const grantPermissions = vi.fn(async () => undefined);
    const context = { grantPermissions };

    await grantCreatorSitePermissions(context as never);

    expect(TOUTIAO_SITE_PERMISSIONS.length).toBeGreaterThanOrEqual(4);
    expect(grantPermissions).toHaveBeenCalledWith(
      [...TOUTIAO_SITE_PERMISSIONS],
      { origin: 'https://mp.toutiao.com' }
    );
    expect(grantPermissions).toHaveBeenCalledWith(
      [...TOUTIAO_SITE_PERMISSIONS],
      { origin: 'https://www.toutiao.com' }
    );
  });

  it('resolves page.context() when given a Page', async () => {
    const grantPermissions = vi.fn(async () => undefined);
    const page = {
      context: () => ({ grantPermissions }),
      goto: async () => undefined
    };

    await grantCreatorSitePermissions(page as never);
    expect(grantPermissions).toHaveBeenCalled();
  });

  it('swallows grant failures', async () => {
    const context = {
      grantPermissions: vi.fn(async () => {
        throw new Error('permission denied by host');
      })
    };
    await expect(grantCreatorSitePermissions(context as never)).resolves.toBeUndefined();
  });
});

