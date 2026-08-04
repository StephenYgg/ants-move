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
  PUBLISH_CONFIRM_BUTTON_NAMES,
  TOUTIAO_ARTICLE_PUBLISH_NEW_URL
} from './form-map.js';
import {
  countContentChars,
  fillArticleBodyWithInlineImages,
  setArticleCoverImages,
  setArticleCoverMode,
  setFirstPublishExclusive,
  setLocation,
  setWorkClaim
} from './form-options.js';
import {
  ARTICLE_SAVE_URL_RE,
  assertNoSaveFailureText,
  createSaveResponseWaiter
} from './save-monitor.js';

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
  /** Optional 添加位置; best-effort, never fails publish. */
  location?: string;
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
    // Disarmed until after fill so typing autosave cannot fake success.
    const saveWaiter = createSaveResponseWaiter(page, ARTICLE_SAVE_URL_RE);

    try {
      await fillArticleForm(page, input);
      saveWaiter.arm();
      await triggerArticleSave(page, input.strategy);
      try {
        return await buildArticleResult(page, input, account, await saveWaiter.wait(60_000));
      } catch (error) {
        const bodyText = await page.locator('body').innerText().catch(() => '');
        assertNoSaveFailureText(bodyText);
        throw error;
      }
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
  // Prefer explicit covers; for 三图 use first three body images when --covers omitted.
  const coverImages = [
    ...(input.coverPath === undefined ? [] : [input.coverPath]),
    ...(input.coverPaths ?? [])
  ];
  let resolvedCovers = coverImages;
  if (resolvedCovers.length === 0) {
    resolvedCovers = input.bodyImagePaths.length >= 3
      ? input.bodyImagePaths.slice(0, 3)
      : input.bodyImagePaths.slice(0, 1);
  }

  // Avoid full prepareCreatorPage — aggressive overlay hide can kill the cover modal.
  await page.keyboard.press('Escape').catch(() => undefined);
  try {
    await page.locator('.article-cover').first()
      .scrollIntoViewIfNeeded()
      .catch(() => undefined);
    await page.waitForTimeout(500);
    if (resolvedCovers.length > 0) {
      await setArticleCoverImages(page, resolvedCovers);
    } else {
      await setArticleCoverMode(page, 'none');
    }
  } catch {
    try {
      const fallback = input.bodyImagePaths.slice(0, 1);
      if (fallback.length > 0) {
        await page.keyboard.press('Escape').catch(() => undefined);
        await page.waitForTimeout(400);
        await setArticleCoverImages(page, fallback);
        return;
      }
    } catch {
      // Fall through.
    }
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
  if (input.location !== undefined && input.location.trim() !== '') {
    // Best-effort only; missing control must not block save/publish.
    await setLocation(page, input.location);
  }
  if (input.firstPublish === true) {
    await setFirstPublishExclusive(page, true, countContentChars(bodyText));
  }
}

async function triggerArticleSave(page: Page, strategy: ToutiaoPublishStrategy): Promise<void> {
  await page.waitForTimeout(2_000);
  await prepareCreatorPage(page);
  if (strategy === 'draft') {
    await clickEditorBackControl(page);
    return;
  }

  // Live publish: clear overlays, primary control, then optional confirm dialog.
  await prepareCreatorPage(page);
  await clickButtonByNames(page, PUBLISH_BUTTON_NAMES, 'publish');
  await page.waitForTimeout(800);
  try {
    await clickButtonByNames(page, PUBLISH_CONFIRM_BUTTON_NAMES, 'confirm publish');
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
