import type { Page, Response } from 'playwright';

import { ToutiaoCommandError } from '../types.js';

export interface ArticleSaveResult {
  code: number;
  message: string;
  pgcId?: string;
  raw: unknown;
  url: string;
}

export const ARTICLE_SAVE_URL_RE = /\/mp\/agw\/article\/publish/i;
/** Micro-post drafts use save_ugc_draft; live publish may use article/publish or wtt. */
export const MICRO_SAVE_URL_RE =
  /\/mp\/agw\/draft\/save_ugc_draft|\/mp\/agw\/article\/publish|\/mp\/agw\/article\/wtt/i;

export interface SaveResponseWaiter {
  /** Start accepting matching POST responses (call after form fill, before save click). */
  arm: () => void;
  wait: (timeoutMs?: number) => Promise<ArticleSaveResult>;
  dispose: () => void;
}

/**
 * Attach a save-response waiter. Autosave often fires while typing.
 * By default the waiter is disarmed until arm() is called, so fill-time
 * autosave cannot be mistaken for the intentional draft/publish click.
 */
export function createSaveResponseWaiter(
  page: Page,
  urlPattern: RegExp,
  options: { armed?: boolean } = {}
): SaveResponseWaiter {
  let armed = options.armed === true;
  let settled = false;
  let resolveFn: ((value: { payload: unknown; url: string }) => void) | undefined;
  let rejectFn: ((error: Error) => void) | undefined;
  const firstResponse = new Promise<{ payload: unknown; url: string }>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  const onResponse = (response: Response): void => {
    if (settled || !armed) {
      return;
    }
    if (response.request().method() !== 'POST') {
      return;
    }
    if (!urlPattern.test(response.url())) {
      return;
    }

    void (async () => {
      try {
        const payload = await response.json();
        if (settled) {
          return;
        }
        settled = true;
        page.off('response', onResponse);
        resolveFn?.({ payload, url: response.url() });
      } catch (error) {
        if (settled) {
          return;
        }
        settled = true;
        page.off('response', onResponse);
        const body = await response.text().catch(() => '');
        rejectFn?.(
          new ToutiaoCommandError(
            'TOUTIAO_PUBLISH_REJECTED',
            'Toutiao save API returned a non-JSON response.',
            1,
            {
              body: body.slice(0, 500),
              cause: error instanceof Error ? error.message : String(error),
              status: response.status(),
              url: response.url()
            }
          )
        );
      }
    })();
  };

  page.on('response', onResponse);

  const dispose = (): void => {
    if (!settled) {
      settled = true;
      page.off('response', onResponse);
    } else {
      page.off('response', onResponse);
    }
  };

  return {
    arm: () => {
      armed = true;
    },
    dispose,
    wait: async (timeoutMs = 45_000) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            if (settled) {
              return;
            }
            settled = true;
            page.off('response', onResponse);
            reject(
              new ToutiaoCommandError(
                'TOUTIAO_PUBLISH_REJECTED',
                'Timed out waiting for Toutiao save API response. The console did not confirm draft/publish success.',
                1,
                { timeoutMs }
              )
            );
          }, timeoutMs);
        });

        const { payload, url } = await Promise.race([firstResponse, timeout]);
        return interpretArticleSaveResult(url, payload);
      } finally {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        dispose();
      }
    }
  };
}

export async function waitForArticleSaveResult(
  page: Page,
  options: { timeoutMs?: number } = {}
): Promise<ArticleSaveResult> {
  const waiter = createSaveResponseWaiter(page, ARTICLE_SAVE_URL_RE, { armed: true });
  return waiter.wait(options.timeoutMs ?? 45_000);
}

export async function waitForMicroSaveResult(
  page: Page,
  options: { timeoutMs?: number } = {}
): Promise<ArticleSaveResult> {
  const waiter = createSaveResponseWaiter(page, MICRO_SAVE_URL_RE, { armed: true });
  return waiter.wait(options.timeoutMs ?? 45_000);
}

export function interpretArticleSaveResult(
  url: string,
  payload: unknown
): ArticleSaveResult {
  const record = asRecord(payload);
  const code = numberField(record, ['code', 'err_no']) ?? -1;
  const message = stringField(record, ['message', 'reason', 'err_tips'])
    ?? 'Unknown save response';
  const data = asRecord(record?.data);
  // Article drafts return data.pgc_id; micro drafts return top-level gid.
  const pgcIdRaw = stringField(data, ['pgc_id', 'item_id', 'gid', 'group_id'])
    ?? stringField(record, ['pgc_id', 'item_id', 'gid', 'group_id']);
  const pgcId = pgcIdRaw && pgcIdRaw !== '0' ? pgcIdRaw : undefined;

  if (code !== 0 || pgcId === undefined) {
    throw new ToutiaoCommandError(
      'TOUTIAO_PUBLISH_REJECTED',
      `Toutiao draft/publish save failed: ${message}`,
      1,
      {
        code,
        message,
        pgcId: pgcIdRaw,
        url
      }
    );
  }

  return {
    code,
    message,
    pgcId,
    raw: payload,
    url
  };
}

export function assertNoSaveFailureText(pageText: string): void {
  if (
    pageText.includes('草稿保存失败')
    || pageText.includes('保存失败')
  ) {
    throw new ToutiaoCommandError(
      'TOUTIAO_PUBLISH_REJECTED',
      'Toutiao creator console reported draft save failure.',
      1,
      { pageHint: '保存失败' }
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function stringField(
  record: Record<string, unknown> | undefined,
  keys: string[]
): string | undefined {
  if (record === undefined) {
    return undefined;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

function numberField(
  record: Record<string, unknown> | undefined,
  keys: string[]
): number | undefined {
  if (record === undefined) {
    return undefined;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}
