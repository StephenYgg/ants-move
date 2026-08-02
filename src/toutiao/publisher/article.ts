import type { Page } from 'playwright';

import type { ToutiaoAuthAccount, ToutiaoPublishResult, ToutiaoPublishStrategy } from '../types.js';
import { ToutiaoCommandError } from '../types.js';
import {
  clickButtonByNames,
  clickEditorBackControl,
  dismissBlockingOverlays,
  fillFirstMatch,
  firstVisibleLocator,
  mapPlaywrightError,
  prepareCreatorPage,
  setFirstFileInput
} from './browser-helpers.js';
import {
  ARTICLE_CONTENT_SELECTORS,
  ARTICLE_TITLE_SELECTORS,
  COVER_INPUT_SELECTORS,
  KEYWORD_INPUT_SELECTORS,
  PUBLISH_BUTTON_NAMES,
  TOUTIAO_ARTICLE_PUBLISH_NEW_URL
} from './form-map.js';
import { createSaveResponseWaiter } from './save-monitor.js';

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
  try {
    const openUrl = `${TOUTIAO_ARTICLE_PUBLISH_NEW_URL}${Date.now()}`;
    await page.goto(openUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000
    });
    await page.waitForTimeout(3000);
    await prepareCreatorPage(page);

    if (await page.locator('#pc_captcha').count() > 0) {
      throw new ToutiaoCommandError(
        'TOUTIAO_VERIFICATION_REQUIRED',
        'Toutiao creator console requires interactive verification before publishing.',
        1
      );
    }

    const saveWaiter = createSaveResponseWaiter(
      page,
      /\/mp\/agw\/article\/publish/i
    );

    try {
      // Wait for the real article editor, not side-panel AI textareas.
      await prepareCreatorPage(page);
      await page.locator('.ProseMirror').first().waitFor({ state: 'visible', timeout: 30_000 });
      const titleBox = page.locator('textarea[placeholder*="标题"]').first();
      await titleBox.waitFor({ state: 'visible', timeout: 30_000 });

      // Match the flow that reliably triggers /article/publish in live monitoring:
      // fill title, keyboard-type body, then wait for autosave.
      await titleBox.click({ force: true });
      await titleBox.fill(input.title);
      await titleBox.evaluate((node) => {
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      });

      const editor = page.locator('.ProseMirror').first();
      await editor.click({ force: true });
      const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
      await page.keyboard.press(`${modifier}+A`).catch(() => undefined);
      await page.keyboard.press('Backspace').catch(() => undefined);
      await page.keyboard.type(input.content.replace(/\n{2,}/g, '\n').trim(), { delay: 20 });

      if (input.coverPath !== undefined) {
        await setFirstFileInput(page, COVER_INPUT_SELECTORS, input.coverPath, 'cover image');
        await page.waitForTimeout(1000);
      } else {
        await page.getByText('无封面', { exact: true }).first()
          .click({ force: true, timeout: 3_000 })
          .catch(() => undefined);
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
        await maybeSelectLabeledOption(page, /声明|原创|权属|作品声明/, input.claim);
      }

      // Give autosave a moment, then use back control as a secondary trigger.
      await page.waitForTimeout(2_000);
      if (input.strategy === 'draft') {
        await clickEditorBackControl(page);
      } else {
        await clickButtonByNames(page, PUBLISH_BUTTON_NAMES, 'publish');
        try {
          await clickButtonByNames(page, [/确认发布/, /确定发布/, /^确定$/, /^确认$/], 'confirm publish');
        } catch {
          // No secondary confirm control.
        }
      }

      const saveResult = await saveWaiter.wait(60_000);
      // Trust the save API result. Page text may still show a transient "保存失败"
      // toast from a previous autosave attempt while the editor was hydrating.
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
