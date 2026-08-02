import { afterEach, describe, expect, it } from 'vitest';

import {
  buildChromiumLaunchOptions,
  DEFAULT_TOUTIAO_BROWSER_CHANNEL,
  resolveToutiaoBrowserChannel,
  TOUTIAO_BROWSER_ENV
} from '../../src/toutiao/browser-channel.js';
import { ToutiaoCommandError } from '../../src/toutiao/types.js';

const originalEnv = process.env[TOUTIAO_BROWSER_ENV];

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env[TOUTIAO_BROWSER_ENV];
  } else {
    process.env[TOUTIAO_BROWSER_ENV] = originalEnv;
  }
});

describe('Toutiao browser channel', () => {
  it('defaults to chrome', () => {
    delete process.env[TOUTIAO_BROWSER_ENV];
    expect(resolveToutiaoBrowserChannel()).toBe(DEFAULT_TOUTIAO_BROWSER_CHANNEL);
    expect(resolveToutiaoBrowserChannel()).toBe('chrome');
  });

  it('accepts explicit and env overrides', () => {
    expect(resolveToutiaoBrowserChannel('msedge')).toBe('msedge');
    expect(resolveToutiaoBrowserChannel('chromium')).toBe('chromium');

    process.env[TOUTIAO_BROWSER_ENV] = 'msedge';
    expect(resolveToutiaoBrowserChannel()).toBe('msedge');
    expect(resolveToutiaoBrowserChannel('chrome')).toBe('chrome');
  });

  it('rejects unsupported browser names', () => {
    expect(() => resolveToutiaoBrowserChannel('safari')).toThrowError(ToutiaoCommandError);
    try {
      resolveToutiaoBrowserChannel('firefox');
    } catch (error) {
      expect(error).toMatchObject({ code: 'TOUTIAO_INVALID_INPUT' });
    }
  });

  it('uses channel for system browsers and omits it for chromium', () => {
    expect(buildChromiumLaunchOptions({ browser: 'chrome', headless: false })).toEqual({
      channel: 'chrome',
      headless: false
    });
    expect(buildChromiumLaunchOptions({ browser: 'msedge', headless: true })).toEqual({
      channel: 'msedge',
      headless: true
    });
    expect(buildChromiumLaunchOptions({ browser: 'chromium', headless: true })).toEqual({
      headless: true
    });
  });
});
