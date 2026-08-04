import type { Page, Response } from 'playwright';
import { describe, expect, it, vi } from 'vitest';

import {
  ARTICLE_SAVE_URL_RE,
  createSaveResponseWaiter,
  interpretArticleSaveResult,
  MICRO_SAVE_URL_RE,
  waitForArticleSaveResult,
  waitForMicroSaveResult
} from '../../src/toutiao/publisher/save-monitor.js';
import { ToutiaoCommandError } from '../../src/toutiao/types.js';

type ResponseHandler = (response: Response) => void;

class FakePage {
  readonly responseHandlers = new Set<ResponseHandler>();

  readonly off = vi.fn((event: string, handler: ResponseHandler) => {
    if (event === 'response') {
      this.responseHandlers.delete(handler);
    }
  });

  readonly on = vi.fn((event: string, handler: ResponseHandler) => {
    if (event === 'response') {
      this.responseHandlers.add(handler);
    }
  });

  async emitResponse(
    url: string,
    json: unknown,
    options: { method?: string; status?: number } = {}
  ): Promise<void> {
    const method = options.method ?? 'POST';
    const status = options.status ?? 200;
    const response = {
      json: async () => json,
      request: () => ({ method: () => method }),
      status: () => status,
      text: async () => JSON.stringify(json),
      url: () => url
    } as unknown as Response;

    for (const handler of [...this.responseHandlers]) {
      handler(response);
    }
    // Allow async onResponse handlers to settle.
    await Promise.resolve();
    await Promise.resolve();
  }
}

const ARTICLE_SAVE_URL = 'https://mp.toutiao.com/mp/agw/article/publish?source=editor';
const MICRO_SAVE_URL = 'https://mp.toutiao.com/mp/agw/draft/save_ugc_draft';
const SUCCESS_PAYLOAD = {
  code: 0,
  message: 'success',
  data: { pgc_id: '1234567890' }
};
const MICRO_SUCCESS_PAYLOAD = {
  code: 0,
  gid: '1872428785810444',
  message: 'success'
};

describe('ARTICLE_SAVE_URL_RE / MICRO_SAVE_URL_RE', () => {
  it('matches article publish URLs', () => {
    expect(ARTICLE_SAVE_URL_RE.test(ARTICLE_SAVE_URL)).toBe(true);
    expect(ARTICLE_SAVE_URL_RE.test(MICRO_SAVE_URL)).toBe(false);
  });

  it('matches micro draft and publish URL variants', () => {
    expect(MICRO_SAVE_URL_RE.test(MICRO_SAVE_URL)).toBe(true);
    expect(MICRO_SAVE_URL_RE.test(ARTICLE_SAVE_URL)).toBe(true);
    expect(MICRO_SAVE_URL_RE.test('https://mp.toutiao.com/mp/agw/article/wtt')).toBe(true);
    expect(MICRO_SAVE_URL_RE.test('https://mp.toutiao.com/mp/agw/other')).toBe(false);
  });
});

describe('createSaveResponseWaiter', () => {
  it('ignores matching POSTs until arm(), then accepts the next matching POST', async () => {
    const page = new FakePage();
    const waiter = createSaveResponseWaiter(
      page as unknown as Page,
      ARTICLE_SAVE_URL_RE
    );

    try {
      // Autosave while filling form — must be ignored while disarmed.
      await page.emitResponse(ARTICLE_SAVE_URL, {
        code: 0,
        message: 'autosave',
        data: { pgc_id: '9999999999' }
      });

      waiter.arm();

      const waitPromise = waiter.wait(5_000);
      await page.emitResponse(ARTICLE_SAVE_URL, SUCCESS_PAYLOAD);

      const result = await waitPromise;
      expect(result.pgcId).toBe('1234567890');
      expect(result.code).toBe(0);
      expect(result.url).toBe(ARTICLE_SAVE_URL);
    } finally {
      waiter.dispose();
    }
  });

  it('accepts matching POSTs immediately when created with armed: true', async () => {
    const page = new FakePage();
    const waiter = createSaveResponseWaiter(
      page as unknown as Page,
      ARTICLE_SAVE_URL_RE,
      { armed: true }
    );

    try {
      const waitPromise = waiter.wait(5_000);
      await page.emitResponse(ARTICLE_SAVE_URL, SUCCESS_PAYLOAD);
      const result = await waitPromise;
      expect(result.pgcId).toBe('1234567890');
    } finally {
      waiter.dispose();
    }
  });

  it('ignores non-POST and non-matching URLs', async () => {
    const page = new FakePage();
    const waiter = createSaveResponseWaiter(
      page as unknown as Page,
      ARTICLE_SAVE_URL_RE,
      { armed: true }
    );

    try {
      const waitPromise = waiter.wait(5_000);

      await page.emitResponse(ARTICLE_SAVE_URL, SUCCESS_PAYLOAD, { method: 'GET' });
      await page.emitResponse('https://mp.toutiao.com/mp/agw/unrelated', SUCCESS_PAYLOAD);

      await page.emitResponse(ARTICLE_SAVE_URL, SUCCESS_PAYLOAD);
      const result = await waitPromise;
      expect(result.pgcId).toBe('1234567890');
    } finally {
      waiter.dispose();
    }
  });
});

describe('waitForArticleSaveResult / waitForMicroSaveResult', () => {
  it('waitForArticleSaveResult is armed by default and captures article publish', async () => {
    const page = new FakePage();
    const waitPromise = waitForArticleSaveResult(page as unknown as Page, {
      timeoutMs: 5_000
    });

    await page.emitResponse(ARTICLE_SAVE_URL, SUCCESS_PAYLOAD);
    const result = await waitPromise;
    expect(result.pgcId).toBe('1234567890');
  });

  it('waitForMicroSaveResult is armed by default and captures micro draft save', async () => {
    const page = new FakePage();
    const waitPromise = waitForMicroSaveResult(page as unknown as Page, {
      timeoutMs: 5_000
    });

    await page.emitResponse(MICRO_SAVE_URL, MICRO_SUCCESS_PAYLOAD);
    const result = await waitPromise;
    expect(result.pgcId).toBe('1872428785810444');
  });
});

describe('interpretArticleSaveResult', () => {
  it('accepts successful save responses with pgc_id', () => {
    const result = interpretArticleSaveResult(
      'https://mp.toutiao.com/mp/agw/article/publish',
      {
        code: 0,
        message: 'success',
        data: { pgc_id: '1234567890' }
      }
    );

    expect(result.pgcId).toBe('1234567890');
    expect(result.code).toBe(0);
  });

  it('accepts micro-post draft responses with top-level gid', () => {
    const result = interpretArticleSaveResult(
      'https://mp.toutiao.com/mp/agw/draft/save_ugc_draft',
      {
        code: 0,
        gid: '1872428785810444',
        message: 'success'
      }
    );

    expect(result.pgcId).toBe('1872428785810444');
  });

  it('rejects 7050 save failures', () => {
    expect(() => interpretArticleSaveResult(
      'https://mp.toutiao.com/mp/agw/article/publish',
      {
        code: 7050,
        data: { pgc_id: '0' },
        err_no: 7050,
        message: '保存失败',
        reason: '保存失败'
      }
    )).toThrowError(ToutiaoCommandError);

    try {
      interpretArticleSaveResult('https://example.test', {
        code: 7050,
        data: { pgc_id: '0' },
        message: '保存失败'
      });
    } catch (error) {
      expect(error).toMatchObject({
        code: 'TOUTIAO_PUBLISH_REJECTED'
      });
    }
  });

  it('rejects success-looking responses without a real pgc_id', () => {
    expect(() => interpretArticleSaveResult('https://example.test', {
      code: 0,
      data: { pgc_id: '0' },
      message: 'ok'
    })).toThrowError(ToutiaoCommandError);
  });
});
