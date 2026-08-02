import type { Page } from 'playwright';

import type { ToutiaoAuthAccount, ToutiaoPublishResult, ToutiaoPublishStrategy } from '../types.js';
import { ToutiaoCommandError } from '../types.js';
import {
  clickButtonByNames,
  dismissBlockingOverlays,
  fillFirstMatch,
  mapPlaywrightError,
  setFirstFileInput,
  waitForDraftAutosave
} from './browser-helpers.js';
import {
  COVER_INPUT_SELECTORS,
  DRAFT_BUTTON_NAMES,
  MICRO_CONTENT_SELECTORS,
  PUBLISH_BUTTON_NAMES,
  TOUTIAO_MICRO_PUBLISH_URL
} from './form-map.js';

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
    await page.goto(TOUTIAO_MICRO_PUBLISH_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000
    });
    await page.waitForTimeout(2000);
    await dismissBlockingOverlays(page);

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

    await fillFirstMatch(page, MICRO_CONTENT_SELECTORS, body, 'micro-post body');

    for (const imagePath of input.imagePaths) {
      await setFirstFileInput(page, COVER_INPUT_SELECTORS, imagePath, 'micro-post image');
      await page.waitForTimeout(800);
    }

    if (input.strategy === 'draft') {
      try {
        await clickButtonByNames(page, DRAFT_BUTTON_NAMES, 'save draft');
      } catch {
        await waitForDraftAutosave(page);
      }
    } else {
      await clickButtonByNames(page, PUBLISH_BUTTON_NAMES, 'publish');
      try {
        await clickButtonByNames(page, [/确认发布/, /确定发布/, /^确定$/, /^确认$/], 'confirm publish');
      } catch {
        // No secondary confirm control.
      }
    }

    await page.waitForTimeout(2000);
    const editUrl = page.url();
    const draftId = /pgc_id=(\d+)/.exec(editUrl)?.[1]
      ?? /item_id=(\d+)/.exec(editUrl)?.[1];

    return {
      ...(account === undefined ? {} : { account }),
      ...(draftId === undefined ? {} : { draftId, itemId: draftId }),
      editUrl,
      status: input.strategy === 'draft' ? 'draft_saved' : 'published',
      strategy: input.strategy,
      type: 'micro',
      url: editUrl
    };
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
