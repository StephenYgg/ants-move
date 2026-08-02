import type { Page } from 'playwright';

import type { ToutiaoAuthAccount, ToutiaoPublishResult, ToutiaoPublishStrategy } from '../types.js';
import { ToutiaoCommandError } from '../types.js';
import {
  clickButtonByNames,
  clickMicroSaveDraftButton,
  mapPlaywrightError,
  prepareCreatorPage,
  setFirstFileInput
} from './browser-helpers.js';
import {
  COVER_INPUT_SELECTORS,
  TOUTIAO_MICRO_PUBLISH_NEW_URL
} from './form-map.js';
import { createSaveResponseWaiter } from './save-monitor.js';

export interface PublishMicroOnPageInput {
  content: string;
  imagePaths: string[];
  strategy: ToutiaoPublishStrategy;
  topic?: string;
}

export async function publishMicroOnPage(
  page: Page,
  input: PublishMicroOnPageInput,
  account?: ToutiaoAuthAccount
): Promise<ToutiaoPublishResult> {
  try {
    const openUrl = `${TOUTIAO_MICRO_PUBLISH_NEW_URL}${Date.now()}`;
    await page.goto(openUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000
    });
    await page.waitForTimeout(3500);
    // Permission prompts + right-side zoom/AI panels block fill and 存草稿.
    await prepareCreatorPage(page);

    if (await page.locator('#pc_captcha').count() > 0) {
      throw new ToutiaoCommandError(
        'TOUTIAO_VERIFICATION_REQUIRED',
        'Toutiao creator console requires interactive verification before publishing.',
        1
      );
    }

    const body = input.topic === undefined || input.topic.trim() === ''
      ? input.content
      : `${input.content}\n\n#${input.topic.replace(/^#/, '')}#`;

    // Micro drafts: POST /mp/agw/draft/save_ugc_draft → { code:0, gid:"..." }
    const saveWaiter = createSaveResponseWaiter(
      page,
      /\/mp\/agw\/draft\/save_ugc_draft|\/mp\/agw\/article\/publish/i
    );

    try {
      await prepareCreatorPage(page);
      const editor = page.locator('.ProseMirror').first();
      await editor.waitFor({ state: 'visible', timeout: 30_000 });
      await editor.click({ force: true });
      const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
      await page.keyboard.press(`${modifier}+A`).catch(() => undefined);
      await page.keyboard.press('Backspace').catch(() => undefined);
      const text = body.replace(/\n{2,}/g, '\n').trim();
      await page.keyboard.type(text, { delay: 25 });
      await page.waitForTimeout(1_200);

      // Ensure the editor actually accepted text before saving.
      const editorText = (await editor.innerText().catch(() => '')).replace(/\s+/g, '');
      if (editorText.length < 2 || editorText.includes('有什么新鲜事')) {
        throw new ToutiaoCommandError(
          'TOUTIAO_UI_CHANGED',
          'Micro-post editor did not accept content before save.',
          1,
          { editorText: editorText.slice(0, 80) }
        );
      }

      for (const imagePath of input.imagePaths) {
        await setFirstFileInput(page, COVER_INPUT_SELECTORS, imagePath, 'micro-post image');
        await page.waitForTimeout(800);
      }

      // Re-clear overlays that reappear after typing (AI / zoom side chrome).
      await prepareCreatorPage(page);

      if (input.strategy === 'draft') {
        // Explicit footer button — not article-style autosave/back.
        await clickMicroSaveDraftButton(page);
      } else {
        await clickButtonByNames(page, [/^发布$/, /发布微头条/, /预览并发布/], 'publish');
        try {
          await clickButtonByNames(
            page,
            [/确认发布/, /确定发布/, /^确定$/, /^确认$/],
            'confirm publish'
          );
        } catch {
          // No secondary confirm control.
        }
      }

      const saveResult = await saveWaiter.wait(45_000);
      const draftId = saveResult.pgcId;
      if (draftId === undefined) {
        throw new ToutiaoCommandError(
          'TOUTIAO_PUBLISH_REJECTED',
          'Toutiao micro-post save response did not include a draft id.',
          1
        );
      }

      const editUrl = page.url().includes('pgc_id=') || page.url().includes('item_id=')
        ? page.url()
        : `https://mp.toutiao.com/profile_v4/weitoutiao/publish?gid=${draftId}`;

      return {
        ...(account === undefined ? {} : { account }),
        draftId,
        itemId: draftId,
        editUrl,
        status: input.strategy === 'draft' ? 'draft_saved' : 'published',
        strategy: input.strategy,
        type: 'micro',
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
      'Toutiao micro-post publish flow failed on the creator console.'
    );
  }
}
