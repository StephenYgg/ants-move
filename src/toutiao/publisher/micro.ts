import type { Page } from 'playwright';

import type { ToutiaoAuthAccount, ToutiaoPublishResult, ToutiaoPublishStrategy } from '../types.js';
import { ToutiaoCommandError } from '../types.js';
import {
  clickButtonByNames,
  fillFirstMatch,
  setFirstFileInput
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
  await page.goto(TOUTIAO_MICRO_PUBLISH_URL, {
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

  const body = input.topic === undefined || input.topic.trim() === ''
    ? input.content
    : `${input.content}\n\n#${input.topic.replace(/^#/, '')}#`;

  await fillFirstMatch(page, MICRO_CONTENT_SELECTORS, body, 'micro-post body');

  for (const imagePath of input.imagePaths) {
    await setFirstFileInput(page, COVER_INPUT_SELECTORS, imagePath, 'micro-post image');
    await page.waitForTimeout(800);
  }

  if (input.strategy === 'draft') {
    await clickButtonByNames(page, DRAFT_BUTTON_NAMES, 'save draft');
  } else {
    await clickButtonByNames(page, PUBLISH_BUTTON_NAMES, 'publish');
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
}
