import type { Page } from 'playwright';

import type { ToutiaoAuthAccount, ToutiaoPublishResult, ToutiaoPublishStrategy } from '../types.js';
import { ToutiaoCommandError } from '../types.js';
import {
  clickButtonByNames,
  fillFirstMatch,
  firstVisibleLocator,
  setFirstFileInput
} from './browser-helpers.js';
import {
  ARTICLE_CONTENT_SELECTORS,
  ARTICLE_TITLE_SELECTORS,
  COVER_INPUT_SELECTORS,
  DRAFT_BUTTON_NAMES,
  KEYWORD_INPUT_SELECTORS,
  PUBLISH_BUTTON_NAMES,
  TOUTIAO_ARTICLE_PUBLISH_URL
} from './form-map.js';

export interface PublishArticleOnPageInput {
  category?: string;
  claim?: string;
  content: string;
  coverPath?: string;
  keywords: string[];
  strategy: ToutiaoPublishStrategy;
  title: string;
}

export async function publishArticleOnPage(
  page: Page,
  input: PublishArticleOnPageInput,
  account?: ToutiaoAuthAccount
): Promise<ToutiaoPublishResult> {
  await page.goto(TOUTIAO_ARTICLE_PUBLISH_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000
  });
  await page.waitForTimeout(1500);

  if (await page.locator('#pc_captcha').count() > 0) {
    throw new ToutiaoCommandError(
      'TOUTIAO_VERIFICATION_REQUIRED',
      'Toutiao creator console requires interactive verification before publishing.',
      1
    );
  }

  await fillFirstMatch(page, ARTICLE_TITLE_SELECTORS, input.title, 'article title');
  await fillFirstMatch(page, ARTICLE_CONTENT_SELECTORS, input.content, 'article body');

  if (input.coverPath !== undefined) {
    await setFirstFileInput(page, COVER_INPUT_SELECTORS, input.coverPath, 'cover image');
    await page.waitForTimeout(1000);
  }

  if (input.keywords.length > 0) {
    const keywordInput = await firstVisibleLocator(page, KEYWORD_INPUT_SELECTORS);
    if (keywordInput !== undefined) {
      for (const keyword of input.keywords) {
        await keywordInput.fill(keyword);
        await keywordInput.press('Enter');
        await page.waitForTimeout(200);
      }
    }
  }

  if (input.category !== undefined) {
    await maybeSelectLabeledOption(page, /分类|类目|栏目/, input.category);
  }

  if (input.claim !== undefined) {
    await maybeSelectLabeledOption(page, /声明|原创|权属/, input.claim);
  }

  if (input.strategy === 'draft') {
    await clickButtonByNames(page, DRAFT_BUTTON_NAMES, 'save draft');
  } else {
    await clickButtonByNames(page, PUBLISH_BUTTON_NAMES, 'publish');
  }

  await page.waitForTimeout(2000);
  const editUrl = page.url();
  const draftId = extractIdFromUrl(editUrl);

  return {
    ...(account === undefined ? {} : { account }),
    ...(draftId === undefined ? {} : { draftId, itemId: draftId }),
    editUrl,
    status: input.strategy === 'draft' ? 'draft_saved' : 'published',
    strategy: input.strategy,
    title: input.title,
    type: 'article',
    url: editUrl
  };
}

async function maybeSelectLabeledOption(
  page: Page,
  labelPattern: RegExp,
  value: string
): Promise<void> {
  // Optional metadata: best-effort only. Do not fail the draft/publish if the
  // console layout does not expose the control.
  try {
    const option = page.getByText(value, { exact: false }).first();
    if ((await option.count()) > 0 && await option.isVisible()) {
      await option.click({ timeout: 5_000 });
      return;
    }

    const labeled = page.getByText(labelPattern).first();
    if ((await labeled.count()) > 0) {
      await labeled.click({ timeout: 5_000 });
      const choice = page.getByText(value, { exact: false }).first();
      if ((await choice.count()) > 0) {
        await choice.click({ timeout: 5_000 });
      }
    }
  } catch {
    // Ignore optional field failures.
  }
}

function extractIdFromUrl(url: string): string | undefined {
  return /pgc_id=(\d+)/.exec(url)?.[1]
    ?? /item_id=(\d+)/.exec(url)?.[1]
    ?? /\/(\d{10,})\//.exec(url)?.[1];
}
