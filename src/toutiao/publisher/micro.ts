import type { Page } from 'playwright';

import type { ToutiaoAuthAccount, ToutiaoPublishResult, ToutiaoPublishStrategy } from '../types.js';
import { ToutiaoCommandError } from '../types.js';
import {
  clickButtonByNames,
  clickMicroSaveDraftButton,
  mapPlaywrightError,
  prepareCreatorPage
} from './browser-helpers.js';
import { TOUTIAO_MICRO_PUBLISH_NEW_URL } from './form-map.js';
import {
  applyMicroTopic,
  countContentChars,
  setFirstPublishExclusive,
  setMicroImages,
  setWorkClaim
} from './form-options.js';
import { createSaveResponseWaiter } from './save-monitor.js';

export interface PublishMicroOnPageInput {
  claim?: string;
  content: string;
  firstPublish?: boolean;
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
    await openMicroEditor(page);
    const saveWaiter = createSaveResponseWaiter(
      page,
      /\/mp\/agw\/draft\/save_ugc_draft|\/mp\/agw\/article\/publish/i
    );

    try {
      await fillMicroForm(page, input);
      await triggerMicroSave(page, input.strategy);
      return await buildMicroResult(page, input, account, await saveWaiter.wait(45_000));
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

async function openMicroEditor(page: Page): Promise<void> {
  const openUrl = `${TOUTIAO_MICRO_PUBLISH_NEW_URL}${Date.now()}`;
  await page.goto(openUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3500);
  await prepareCreatorPage(page);

  if (await page.locator('#pc_captcha').count() > 0) {
    throw new ToutiaoCommandError(
      'TOUTIAO_VERIFICATION_REQUIRED',
      'Toutiao creator console requires interactive verification before publishing.',
      1
    );
  }
}

async function fillMicroForm(page: Page, input: PublishMicroOnPageInput): Promise<void> {
  await prepareCreatorPage(page);
  const editor = page.locator('.ProseMirror').first();
  await editor.waitFor({ state: 'visible', timeout: 30_000 });
  await typeMicroContent(page, editor, input.content.replace(/\n{2,}/g, '\n').trim());

  if (input.imagePaths.length > 0) {
    await setMicroImages(page, input.imagePaths);
    await page.waitForTimeout(800);
  }
  if (input.topic !== undefined && input.topic.trim() !== '') {
    await applyMicroTopic(page, input.topic);
    await page.waitForTimeout(400);
  }
  if (input.claim !== undefined) {
    await setWorkClaim(page, input.claim);
  }
  if (input.firstPublish === true) {
    const text = input.content.replace(/\n{2,}/g, '\n').trim();
    const chars = countContentChars((await editor.innerText().catch(() => text)) || text);
    await setFirstPublishExclusive(page, true, chars);
  }

  await prepareCreatorPage(page);
}

async function typeMicroContent(
  page: Page,
  editor: ReturnType<Page['locator']>,
  text: string
): Promise<void> {
  await editor.click({ force: true });
  await page.waitForTimeout(300);
  await editor.evaluate((node) => {
    const el = node as HTMLElement;
    el.focus();
    const selection = window.getSelection();
    if (selection === null) {
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.press('Backspace').catch(() => undefined);
  await editor.evaluate((node) => {
    const el = node as HTMLElement;
    el.focus();
    const selection = window.getSelection();
    if (selection === null) {
      return;
    }
    selection.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.addRange(range);
  });
  await page.keyboard.type(text, { delay: 18 });
  await page.waitForTimeout(1_000);

  let editorText = (await editor.innerText().catch(() => '')).replace(/\s+/g, '');
  if (editorText.length < 2 || editorText.includes('有什么新鲜事')) {
    await editor.click({ force: true });
    await page.keyboard.type(text, { delay: 20 });
    await page.waitForTimeout(800);
    editorText = (await editor.innerText().catch(() => '')).replace(/\s+/g, '');
  }
  if (editorText.length < 2 || editorText.includes('有什么新鲜事')) {
    throw new ToutiaoCommandError(
      'TOUTIAO_UI_CHANGED',
      'Micro-post editor did not accept content before save.',
      1,
      { editorText: editorText.slice(0, 80) }
    );
  }
}

async function triggerMicroSave(page: Page, strategy: ToutiaoPublishStrategy): Promise<void> {
  if (strategy === 'draft') {
    await clickMicroSaveDraftButton(page);
    return;
  }

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

async function buildMicroResult(
  page: Page,
  input: PublishMicroOnPageInput,
  account: ToutiaoAuthAccount | undefined,
  saveResult: { pgcId?: string }
): Promise<ToutiaoPublishResult> {
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
}
