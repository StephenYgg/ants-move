import { describe, expect, it } from 'vitest';

import { sanitizeStorageState } from '../../src/xianyu/storage-state.js';

describe('sanitizeStorageState', () => {
  it('keeps session cookies and drops huge analytics payloads', () => {
    const sanitized = sanitizeStorageState({
      cookies: [
        {
          name: 'cookie2',
          value: 'session-token',
          domain: '.goofish.com',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax'
        },
        {
          name: 'APLUS_S_CORE_blob',
          value: `!function(){${'x'.repeat(20_000)}}();`,
          domain: '.goofish.com',
          path: '/',
          expires: -1,
          httpOnly: false,
          secure: true,
          sameSite: 'Lax'
        },
        {
          name: 'unrelated',
          value: '1',
          domain: '.evil.example',
          path: '/',
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: 'Lax'
        }
      ],
      origins: [
        {
          origin: 'https://www.goofish.com',
          localStorage: [{ name: 'k', value: 'v' }]
        }
      ]
    });

    expect(sanitized.cookies).toHaveLength(1);
    expect(sanitized.cookies[0]?.name).toBe('cookie2');
    expect(sanitized.origins).toHaveLength(1);
  });

  it('rejects empty usable cookie sets', () => {
    expect(() => sanitizeStorageState({ cookies: [], origins: [] }))
      .toThrowError(/no usable session cookies/i);
  });
});
