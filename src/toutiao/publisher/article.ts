import type { Page } from 'playwright';

import type { ToutiaoAuthAccount, ToutiaoPublishResult, ToutiaoPublishStrategy } from '../types.js';
import { ToutiaoCommandError } from '../types.js';
import {
  clickButtonByNames,
  clickEditorBackControl,
  dismissBlockingOverlays,
  firstVisibleLocator,
  mapPlaywrightError,
  prepareCreatorPage
} from './browser-helpers.js';
import {
  KEYWORD_INPUT_SELECTORS,
  PUBLISH_BUTTON_NAMES,
  TOUTIAO_ARTICLE_PUBLISH_NEW_URL
} from './form-map.js';
import {
  countContentChars,
  fillArticleBodyWithInlineImages,
  setArticleCoverImages,
  setArticleCoverMode,
  setFirstPublishExclusive,
  setWorkClaim
} from './form-options.js';
import { createSaveResponseWaiter } from './save-monitor.js';

export interface PublishArticleOnPageInput {
  /** Body images embedded between paragraphs (required ≥3). */
  bodyImagePaths: string[];
  category?: string;
  claim?: string;
  content: string;
  coverPath?: string;
  /** Extra cover images for 三图 mode (optional; with coverPath max 3). */
  coverPaths?: string[];
  firstPublish?: boolean;
  keywords: string[];
  strategy: ToutiaoPublishStrategy;
  title: string;
}

export async function publishArticleOnPage(
  page: Page,
  input: PublishArticleOnPageInput,
  account?: ToutiaoAuthAccount
): Promise<ToutiaoPublishResult> {
  try {
    await openArticleEditor(page);
    const saveWaiter = createSaveResponseWaiter(page, /\/mp\/agw\/article\/publish/i);

    try {
      await fillArticleForm(page, input);
      await triggerArticleSave(page, input.strategy);
      return await buildArticleResult(page, input, account, await saveWaiter.wait(60_000));
    } finally {
      saveWaiter.dispose();
    }
  } catch (error) {
    if (error instanceof ToutiaoCommandError) {
      throw error;
    }
    throw mapPlaywrightError(
      error,
      'Toutiao article publish flow failed on the creator console.'
    );
  }
}

async function openArticleEditor(page: Page): Promise<void> {
  const openUrl = `${TOUTIAO_ARTICLE_PUBLISH_NEW_URL}${Date.now()}`;
  await page.goto(openUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3000);
  await prepareCreatorPage(page);

  if (await page.locator('#pc_captcha').count() > 0) {
    throw new ToutiaoCommandError(
      'TOUTIAO_VERIFICATION_REQUIRED',
      'Toutiao creator console requires interactive verification before publishing.',
      1
    );
  }
}

async function fillArticleForm(page: Page, input: PublishArticleOnPageInput): Promise<void> {
  await prepareCreatorPage(page);
  await page.locator('.ProseMirror').first().waitFor({ state: 'visible', timeout: 30_000 });
  const titleBox = page.locator('textarea[placeholder*="标题"]').first();
  await titleBox.waitFor({ state: 'visible', timeout: 30_000 });

  await titleBox.click({ force: true });
  await titleBox.fill(input.title);
  await titleBox.evaluate((node) => {
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });

  const bodyText = input.content.trim();
  await fillArticleBodyWithInlineImages(page, bodyText, input.bodyImagePaths);
  await applyArticleCover(page, input);
  await applyArticleMetadata(page, input, bodyText);
}

async function applyArticleCover(page: Page, input: PublishArticleOnPageInput): Promise<void> {
  const coverImages = [
    ...(input.coverPath === undefined ? [] : [input.coverPath]),
    ...(input.coverPaths ?? [])
  ];
  const resolvedCovers = coverImages.length > 0
    ? coverImages
    : input.bodyImagePaths.slice(0, 1);

  await prepareCreatorPage(page);
  try {
    await page.locator('.article-cover, text=展示封面').first()
      .scrollIntoViewIfNeeded()
      .catch(() => undefined);
    await page.waitForTimeout(400);
    if (resolvedCovers.length > 0) {
      await setArticleCoverImages(page, resolvedCovers);
    } else {
      await setArticleCoverMode(page, 'none');
    }
  } catch {
    await setArticleCoverMode(page, 'none').catch(() => undefined);
  }
}

async function applyArticleMetadata(
  page: Page,
  input: PublishArticleOnPageInput,
  bodyText: string
): Promise<void> {
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
    await setWorkClaim(page, input.claim);
  }
  if (input.firstPublish === true) {
    await setFirstPublishExclusive(page, true, countContentChars(bodyText));
  }
}

async function triggerArticleSave(page: Page, strategy: ToutiaoPublishStrategy): Promise<void> {
  await page.waitForTimeout(2_000);
  if (strategy === 'draft') {
    await clickEditorBackControl(page);
    return;
  }

  await clickButtonByNames(page, PUBLISH_BUTTON_NAMES, 'publish');
  try {
    await clickButtonByNames(page, [/确认发布/, /确定发布/, /^确定$/, /^确认$/], 'confirm publish');
  } catch {
    // No secondary confirm control.
  }
}

async function buildArticleResult(
  page: Page,
  input: PublishArticleOnPageInput,
  account: ToutiaoAuthAccount | undefined,
  saveResult: { pgcId?: string }
): Promise<ToutiaoPublishResult> {
  const pgcId = saveResult.pgcId;
  if (pgcId === undefined) {
    throw new ToutiaoCommandError(
      'TOUTIAO_PUBLISH_REJECTED',
      'Toutiao save response did not include a draft id.',
      1
    );
  }

  const editUrl = page.url().includes('pgc_id=')
    ? page.url()
    : `https://mp.toutiao.com/profile_v4/graphic/publish?pgc_id=${pgcId}`;

  return {
    ...(account === undefined ? {} : { account }),
    draftId: pgcId,
    itemId: pgcId,
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
  try {
    await dismissBlockingOverlays(page);
    const option = page.getByText(value, { exact: false }).first();
    if ((await option.count()) > 0 && await option.isVisible()) {
      await option.click({ timeout: 5_000, force: true });
      return;
    }

    const labeled = page.getByText(labelPattern).first();
    if ((await labeled.count()) > 0) {
      await labeled.click({ timeout: 5_000, force: true });
      const choice = page.getByText(value, { exact: false }).first();
      if ((await choice.count()) > 0) {
        await choice.click({ timeout: 5_000, force: true });
      }
    }
  } catch {
    // Ignore optional field failures.
  }
}
