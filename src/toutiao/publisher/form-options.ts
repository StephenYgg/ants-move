import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import type { Locator, Page } from 'playwright';

import { ToutiaoCommandError } from '../types.js';
import { dismissBlockingOverlays, uiChangedError } from './browser-helpers.js';

const execFileAsync = promisify(execFile);

/** Creator console requires ≥100 body chars before 头条首发 can stick. */
export const MIN_FIRST_PUBLISH_CONTENT_CHARS = 100;

export type ArticleCoverMode = 'single' | 'triple' | 'none';

/**
 * Select 展示封面 radio: 单图 / 三图 / 无封面.
 */
export async function setArticleCoverMode(
  page: Page,
  mode: ArticleCoverMode
): Promise<void> {
  await dismissBlockingOverlays(page);
  const label = mode === 'single' ? '单图' : mode === 'triple' ? '三图' : '无封面';
  const radio = page.locator('label.byte-radio', { hasText: new RegExp(`^${label}$`) }).first();
  if ((await radio.count()) === 0) {
    throw uiChangedError(`Could not find cover mode radio: ${label}`);
  }
  await radio.click({ force: true, timeout: 10_000 });
  await page.waitForTimeout(300);
}

/**
 * Upload cover image(s) for article 展示封面.
 * Flow: select 单图|三图 → open + slot → 本地上传 / file input → 确定.
 * Throws if cover cannot be set (callers may catch for best-effort).
 */
export async function setArticleCoverImages(
  page: Page,
  imagePaths: string[]
): Promise<void> {
  if (imagePaths.length === 0) {
    await setArticleCoverMode(page, 'none');
    return;
  }

  const mode: ArticleCoverMode = imagePaths.length >= 3 ? 'triple' : 'single';
  const paths = imagePaths.slice(0, mode === 'triple' ? 3 : 1);

  // Do not run full overlay dismiss here — it can hide the cover media modal.
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.locator('.article-cover, .pgc-edit-cell').filter({ hasText: /展示封面|单图|三图/ })
    .first()
    .scrollIntoViewIfNeeded()
    .catch(() => undefined);
  await page.waitForTimeout(300);

  await setArticleCoverMode(page, mode);
  await page.waitForTimeout(500);

  await openArticleCoverUploadSlot(page);
  await uploadImagesInMediaModal(page, paths);

  // Verify cover area shows a preview image (not only the + placeholder).
  const preview = page.locator('.article-cover img').first();
  const hasPreview = await preview
    .waitFor({ state: 'visible', timeout: 12_000 })
    .then(() => true)
    .catch(() => false);
  if (!hasPreview) {
    // Triple mode may render multiple slots; any cover img counts.
    const count = await page.locator('.article-cover img').count().catch(() => 0);
    if (count === 0) {
      throw uiChangedError('Cover image preview did not appear after upload.', {
        mode,
        paths
      });
    }
  }
  await page.waitForTimeout(400);
}

async function openArticleCoverUploadSlot(page: Page): Promise<void> {
  const coverRoot = page.locator('.article-cover').first();
  await coverRoot.waitFor({ state: 'visible', timeout: 10_000 });

  const slotCandidates = [
    coverRoot.locator('[class*="upload"]').first(),
    coverRoot.locator('[class*="plus"]').first(),
    coverRoot.locator('svg').first(),
    coverRoot.getByText('+', { exact: true }).first(),
    coverRoot.locator('.byte-upload, [class*="Upload"]').first()
  ];

  for (const slot of slotCandidates) {
    if ((await slot.count().catch(() => 0)) === 0) {
      continue;
    }
    if (!(await slot.isVisible().catch(() => false))) {
      continue;
    }
    await slot.click({ force: true, timeout: 8_000 });
    await page.waitForTimeout(700);
    if (await isMediaUploadUiOpen(page)) {
      return;
    }
  }

  // Coordinate click near the first + tile.
  const box = await coverRoot.boundingBox();
  if (box !== null) {
    await page.mouse.click(box.x + 40, box.y + 80);
    await page.waitForTimeout(700);
    if (await isMediaUploadUiOpen(page)) {
      return;
    }
  }

  throw uiChangedError('Could not open the article cover upload UI.');
}

async function isMediaUploadUiOpen(page: Page): Promise<boolean> {
  if (await page.getByRole('button', { name: /本地上传/ }).first().isVisible().catch(() => false)) {
    return true;
  }
  if ((await page.locator('input[type="file"]').count()) > 0) {
    return true;
  }
  if (await page.locator('.mp-ic-img-drawer, .byte-modal, text=上传图片').first().isVisible().catch(() => false)) {
    return true;
  }
  return false;
}

/**
 * Micro-post images via toolbar 图片 → 本地上传 → 确定.
 */
export async function setMicroImages(
  page: Page,
  imagePaths: string[]
): Promise<void> {
  if (imagePaths.length === 0) {
    return;
  }

  await dismissBlockingOverlays(page);
  const imageButton = page.getByRole('button', { name: '图片' }).first();
  if ((await imageButton.count()) === 0) {
    throw uiChangedError('Could not find the micro-post 图片 toolbar button.');
  }
  await imageButton.click({ force: true, timeout: 10_000 });
  await page.waitForTimeout(800);

  await uploadImagesInMediaModal(page, imagePaths);
}

export type BodySegment =
  | { type: 'text'; value: string }
  | { type: 'image'; path: string };

/**
 * Split article body into paragraphs and interleave images between them.
 * Guarantees every image path appears once, embedded in the document flow.
 */
export function buildArticleBodySegments(
  content: string,
  imagePaths: string[]
): BodySegment[] {
  const paragraphs = content
    .split(/\n{2,}|\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const body = paragraphs.length > 0 ? paragraphs : [content.trim()].filter(Boolean);
  const segments: BodySegment[] = [];
  const images = [...imagePaths];

  if (body.length === 0) {
    for (const path of images) {
      segments.push({ type: 'image', path });
    }
    return segments;
  }

  // Spread images across paragraphs: after para0, after para1, ... then remainder at end.
  for (let index = 0; index < body.length; index += 1) {
    segments.push({ type: 'text', value: body[index] as string });
    if (images.length > 0 && index < body.length - 1) {
      const path = images.shift();
      if (path !== undefined) {
        segments.push({ type: 'image', path });
      }
    }
  }

  // Remaining images (including when only one paragraph): append after last text.
  while (images.length > 0) {
    const path = images.shift();
    if (path !== undefined) {
      segments.push({ type: 'image', path });
    }
  }

  return segments;
}

/**
 * Type article body with inline images inserted between paragraphs.
 * Primary path: clipboard paste at collapsed end caret (must not overwrite).
 * Fallback: toolbar image drawer.
 */
export async function fillArticleBodyWithInlineImages(
  page: Page,
  content: string,
  imagePaths: string[]
): Promise<void> {
  const editor = page.locator('.ProseMirror').first();
  await editor.waitFor({ state: 'visible', timeout: 30_000 });
  await clearEditorContent(page, editor);

  const segments = buildArticleBodySegments(content, imagePaths);
  const requiredTextSnippets: string[] = [];

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] as BodySegment;
    if (segment.type === 'text') {
      await focusEditorEndCollapsed(page, editor);
      await page.keyboard.type(segment.value, { delay: 12 });
      // Keep a short fingerprint so later pastes cannot silently wipe prior text.
      const fingerprint = segment.value.replace(/\s+/g, '').slice(0, 12);
      if (fingerprint.length >= 4) {
        requiredTextSnippets.push(fingerprint);
      }
      if (index < segments.length - 1) {
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
      }
      continue;
    }

    const textBefore = await readEditorPlainText(editor);
    await insertArticleInlineImage(page, segment.path);
    const textAfter = await readEditorPlainText(editor);
    assertTextNotOverwritten(textBefore, textAfter, requiredTextSnippets);

    if (index < segments.length - 1) {
      await focusEditorEndCollapsed(page, editor);
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
    }
  }

  // Final integrity check: every typed fingerprint still present.
  const finalText = await readEditorPlainText(editor);
  for (const snippet of requiredTextSnippets) {
    if (!finalText.replace(/\s+/g, '').includes(snippet)) {
      throw uiChangedError(
        'Article body text was lost after embedding images (overwrite detected).',
        { missing: snippet, finalText: finalText.slice(0, 200) }
      );
    }
  }

  const imgCount = await countBodyImages(editor);
  if (imgCount < imagePaths.length) {
    throw uiChangedError(
      `Article body expected at least ${imagePaths.length} embedded images, found ${imgCount}.`,
      { expected: imagePaths.length, found: imgCount }
    );
  }

  await page.waitForTimeout(400);
}

async function clearEditorContent(page: Page, editor: Locator): Promise<void> {
  await editor.click({ force: true });
  // Explicit select-all only for the initial clear — never before paste.
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
  await page.waitForTimeout(100);
}

/**
 * Focus the editor and collapse the caret to the absolute end.
 * Critical: selection must be empty, otherwise paste replaces prior content.
 */
async function focusEditorEndCollapsed(page: Page, editor: Locator): Promise<void> {
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
    range.collapse(false); // caret at end, nothing selected
    selection.addRange(range);

    // Double-check: if a non-collapsed selection remains, force collapse.
    if (!selection.isCollapsed && selection.rangeCount > 0) {
      const current = selection.getRangeAt(0);
      current.collapse(false);
      selection.removeAllRanges();
      selection.addRange(current);
    }
  });
  await page.waitForTimeout(60);
  // Nudge right to leave any atomic image node selection.
  await page.keyboard.press('ArrowRight').catch(() => undefined);
  await page.waitForTimeout(40);
}

async function readEditorPlainText(editor: Locator): Promise<string> {
  return (await editor.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
}

function assertTextNotOverwritten(
  before: string,
  after: string,
  requiredSnippets: string[]
): void {
  const normalizedAfter = after.replace(/\s+/g, '');
  for (const snippet of requiredSnippets) {
    if (!normalizedAfter.includes(snippet)) {
      throw uiChangedError(
        'Paste overwrote existing article body text instead of inserting at caret.',
        {
          missing: snippet,
          before: before.slice(0, 160),
          after: after.slice(0, 160)
        }
      );
    }
  }
}

/**
 * Descriptor for an <img> found inside the article editor.
 * Used by pure counting logic so unit tests need no Playwright.
 */
export type BodyImageCandidate = {
  /** True when the img sits under a .pgc-img content wrapper. */
  inPgcImg: boolean;
  /** Rendered or declared width in CSS pixels (0 if unknown). */
  width: number;
  /** Rendered or declared height in CSS pixels (0 if unknown). */
  height: number;
};

/** Icons and toolbar chrome are typically ≤32px on both axes. */
const TINY_ICON_MAX_PX = 32;

/**
 * Count only real content images among editor img candidates.
 * Prefer `.pgc-img img` when any exist; otherwise all non-tiny imgs.
 */
export function countBodyImageCandidates(images: BodyImageCandidate[]): number {
  const isTinyIcon = (image: BodyImageCandidate): boolean =>
    image.width > 0
    && image.height > 0
    && image.width <= TINY_ICON_MAX_PX
    && image.height <= TINY_ICON_MAX_PX;

  const pgc = images.filter((image) => image.inPgcImg);
  const pool = pgc.length > 0 ? pgc : images;
  return pool.filter((image) => !isTinyIcon(image)).length;
}

/**
 * Count content images inside a ProseMirror article body.
 * Ignores UI chrome / tiny icons that may appear under the editor root.
 */
export async function countBodyImages(editor: Locator): Promise<number> {
  const candidates = await editor.evaluate((root) => {
    const result: Array<{ inPgcImg: boolean; width: number; height: number }> = [];
    const imgs = root.querySelectorAll('img');
    for (const node of imgs) {
      const img = node as HTMLImageElement;
      const rect = img.getBoundingClientRect();
      const width = rect.width
        || img.naturalWidth
        || img.width
        || Number(img.getAttribute('width'))
        || 0;
      const height = rect.height
        || img.naturalHeight
        || img.height
        || Number(img.getAttribute('height'))
        || 0;
      result.push({
        inPgcImg: img.closest('.pgc-img') !== null,
        width,
        height
      });
    }
    return result;
  }).catch(() => [] as BodyImageCandidate[]);

  return countBodyImageCandidates(candidates);
}

/**
 * Insert one image at the current caret in the article ProseMirror editor.
 * Prefer clipboard paste; fall back to toolbar drawer upload.
 */
export async function insertArticleInlineImage(
  page: Page,
  imagePath: string
): Promise<void> {
  const editor = page.locator('.ProseMirror').first();
  const beforeCount = await countBodyImages(editor);

  await page.keyboard.press('Escape').catch(() => undefined);
  await focusEditorEndCollapsed(page, editor);

  const pasted = await pasteImageViaClipboard(page, editor, imagePath, beforeCount);
  if (pasted) {
    return;
  }

  const uploaded = await insertImageViaToolbarDrawer(page, editor, imagePath, beforeCount);
  if (uploaded) {
    return;
  }

  throw uiChangedError(
    'Failed to embed article body image via clipboard paste and toolbar upload.',
    { beforeCount, imagePath }
  );
}

/**
 * Copy a local image to the OS clipboard, then paste into the focused editor.
 * Must collapse selection first — a non-empty selection replaces body text.
 */
async function pasteImageViaClipboard(
  page: Page,
  editor: Locator,
  imagePath: string,
  beforeCount: number
): Promise<boolean> {
  try {
    await copyImageToSystemClipboard(imagePath);
  } catch {
    // Fall through to in-page clipboard write.
    try {
      await copyImageToPageClipboard(page, imagePath);
    } catch {
      return false;
    }
  }

  await focusEditorEndCollapsed(page, editor);
  // Ensure selection is collapsed one more time right before paste.
  const collapsed = await editor.evaluate(() => {
    const selection = window.getSelection();
    return selection !== null && selection.isCollapsed;
  }).catch(() => false);
  if (!collapsed) {
    await focusEditorEndCollapsed(page, editor);
  }

  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+v`);
  return await waitForEditorImageIncrease(editor, beforeCount, 12_000);
}

async function copyImageToSystemClipboard(imagePath: string): Promise<void> {
  if (process.platform === 'darwin') {
    // PNGf is reliable for Chrome paste on macOS.
    const escaped = imagePath.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    await execFileAsync('osascript', [
      '-e',
      `set the clipboard to (read (POSIX file "${escaped}") as «class PNGf»)`
    ], { timeout: 10_000 });
    return;
  }

  if (process.platform === 'linux') {
    await execFileAsync('xclip', [
      '-selection',
      'clipboard',
      '-t',
      'image/png',
      '-i',
      imagePath
    ], { timeout: 10_000 });
    return;
  }

  // Windows: PowerShell Set-Clipboard does not handle raw images well; use page clipboard.
  throw new Error('System clipboard image copy is not supported on this platform.');
}

async function copyImageToPageClipboard(page: Page, imagePath: string): Promise<void> {
  const bytes = await readFile(imagePath);
  const lower = imagePath.toLowerCase();
  const mime = lower.endsWith('.jpg') || lower.endsWith('.jpeg')
    ? 'image/jpeg'
    : lower.endsWith('.gif')
      ? 'image/gif'
      : lower.endsWith('.webp')
        ? 'image/webp'
        : 'image/png';
  const base64 = bytes.toString('base64');

  await page.evaluate(async ({ data, type }) => {
    const binary = atob(data);
    const array = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      array[index] = binary.charCodeAt(index);
    }
    const blob = new Blob([array], { type });
    // Requires clipboard-write permission on a secure context.
    await navigator.clipboard.write([
      new ClipboardItem({ [type]: blob })
    ]);
  }, { data: base64, type: mime });
}

/**
 * Fallback: toolbar image drawer + setInputFiles + 确定.
 */
async function insertImageViaToolbarDrawer(
  page: Page,
  editor: Locator,
  imagePath: string,
  beforeCount: number
): Promise<boolean> {
  try {
    await page.keyboard.press('Escape').catch(() => undefined);
    await focusEditorEndCollapsed(page, editor);

    const imageTool = page.locator('.syl-toolbar-tool.image').first();
    if ((await imageTool.count()) === 0) {
      return false;
    }
    await imageTool.scrollIntoViewIfNeeded().catch(() => undefined);
    await imageTool.locator('button').click({ force: true, timeout: 8_000 });
    await page.waitForTimeout(1_200);

    const fileInput = page.locator('input[type="file"]').first();
    if ((await fileInput.count()) > 0) {
      await fileInput.setInputFiles(imagePath);
    } else {
      const localUpload = page
        .locator('.mp-ic-img-drawer, .primary-drawer')
        .getByRole('button', { name: /本地上传/ })
        .first();
      if (!(await localUpload.isVisible().catch(() => false))) {
        return false;
      }
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 10_000 }).catch(() => null),
        localUpload.click({ force: true })
      ]);
      if (chooser === null) {
        return false;
      }
      await chooser.setFiles(imagePath);
    }

    await page.waitForTimeout(2_000);
    const confirm = page
      .locator('.mp-ic-img-drawer, .primary-drawer')
      .getByRole('button', { name: /^确定$/ })
      .first();
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.click({ force: true, timeout: 5_000 });
    } else {
      await confirmMediaModal(page);
    }

    return await waitForEditorImageIncrease(editor, beforeCount, 15_000);
  } catch {
    return false;
  }
}

async function waitForEditorImageIncrease(
  editor: Locator,
  beforeCount: number,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const afterCount = await countBodyImages(editor);
    if (afterCount > beforeCount) {
      await editor.page().waitForTimeout(350);
      return true;
    }
    await editor.page().waitForTimeout(250);
  }
  return false;
}

/**
 * Shared media modal/drawer: set files then confirm with 确定.
 * Cover flow and micro toolbar both land on 本地上传 + optional file inputs.
 */
export async function uploadImagesInMediaModal(
  page: Page,
  imagePaths: string[]
): Promise<void> {
  // Wait until either 本地上传 or a file input is present.
  const openDeadline = Date.now() + 10_000;
  let hasLocal = false;
  let hasFile = false;
  while (Date.now() < openDeadline) {
    hasLocal = await page.getByRole('button', { name: /本地上传/ }).first()
      .isVisible()
      .catch(() => false);
    hasFile = (await page.locator('input[type="file"]').count()) > 0;
    if (hasLocal || hasFile) {
      break;
    }
    await page.waitForTimeout(200);
  }

  if (hasFile && !hasLocal) {
    await setFilesOnAnyInput(page, imagePaths);
  } else if (hasLocal) {
    const localUpload = page.getByRole('button', { name: /本地上传/ }).first();
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 12_000 }).catch(() => null),
      localUpload.click({ force: true })
    ]);
    if (chooser !== null) {
      await chooser.setFiles(imagePaths);
    } else {
      await page.waitForTimeout(500);
      await setFilesOnAnyInput(page, imagePaths);
    }
  } else {
    throw uiChangedError(
      'Image upload UI opened but no file input or 本地上传 control was available.'
    );
  }

  // Wait for upload preview thumbnail(s) then confirm.
  await page.waitForTimeout(2_200);
  await confirmMediaModal(page);
  // Close residual drawers/modals so later form steps are not blocked.
  if (await page.getByRole('button', { name: /本地上传/ }).first().isVisible().catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(300);
  }
}

async function setFilesOnAnyInput(page: Page, imagePaths: string[]): Promise<void> {
  const inputs = page.locator('input[type="file"]');
  const count = await inputs.count();
  if (count === 0) {
    throw uiChangedError('No file input available for image upload.');
  }
  // Prefer the visible / non-zero sized input; fall back to first.
  for (let index = 0; index < count; index += 1) {
    const input = inputs.nth(index);
    try {
      await input.setInputFiles(imagePaths);
      return;
    } catch {
      // Try next input.
    }
  }
  throw uiChangedError('Failed to set image files on any file input.');
}

async function confirmMediaModal(page: Page): Promise<void> {
  // Article image drawer and micro upload modal both use a primary 确定.
  const confirmCandidates = [
    page.locator('.mp-ic-img-drawer').getByRole('button', { name: /^确定$/ }).first(),
    page.locator('.primary-drawer').getByRole('button', { name: /^确定$/ }).first(),
    page.locator('.byte-drawer').getByRole('button', { name: /^确定$/ }).last(),
    page.locator('.byte-modal').getByRole('button', { name: /^确定$/ }).last(),
    page.getByRole('button', { name: /^确定$/ }).last(),
    page.getByRole('button', { name: /^完成$/ }).last(),
    page.getByRole('button', { name: /^使用$/ }).last()
  ];

  for (const button of confirmCandidates) {
    if (await button.isVisible().catch(() => false)) {
      await button.click({ force: true, timeout: 5_000 }).catch(() => undefined);
      await page.waitForTimeout(1_000);
      return;
    }
  }
}

/**
 * Toggle 头条首发 checkbox. Requires body length ≥ MIN_FIRST_PUBLISH_CONTENT_CHARS.
 */
export async function setFirstPublishExclusive(
  page: Page,
  enabled: boolean,
  contentCharCount: number
): Promise<void> {
  if (!enabled) {
    return;
  }

  if (contentCharCount < MIN_FIRST_PUBLISH_CONTENT_CHARS) {
    throw new ToutiaoCommandError(
      'TOUTIAO_INVALID_INPUT',
      `头条首发 requires at least ${MIN_FIRST_PUBLISH_CONTENT_CHARS} content characters (got ${contentCharCount}).`,
      2,
      { min: MIN_FIRST_PUBLISH_CONTENT_CHARS, provided: contentCharCount }
    );
  }

  await dismissBlockingOverlays(page);
  const label = page.locator('label.byte-checkbox', { hasText: '头条首发' }).first();
  if ((await label.count()) === 0) {
    throw uiChangedError('Could not find the 头条首发 checkbox.');
  }

  const already = await isByteCheckboxChecked(label);
  if (already === enabled) {
    return;
  }

  // Click the visible mask/text rather than the hidden native input.
  await label.locator('.byte-checkbox-mask, .byte-checkbox-inner-text, span').first()
    .click({ force: true, timeout: 5_000 })
    .catch(async () => {
      await label.click({ force: true, timeout: 5_000 });
    });
  await page.waitForTimeout(500);

  const checked = await isByteCheckboxChecked(label);
  if (checked !== enabled) {
    // Retry once via native input.
    const input = label.locator('input[type="checkbox"]').first();
    if (enabled) {
      await input.check({ force: true }).catch(() => undefined);
    } else {
      await input.uncheck({ force: true }).catch(() => undefined);
    }
    await page.waitForTimeout(400);
  }

  const finalChecked = await isByteCheckboxChecked(label);
  if (finalChecked !== enabled) {
    // Surface console toast if present (e.g. length rule).
    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (bodyText.includes('不少于100字') || bodyText.includes('不少于 100')) {
      throw new ToutiaoCommandError(
        'TOUTIAO_INVALID_INPUT',
        '头条首发 was rejected: content must be at least 100 characters.',
        2
      );
    }
    throw uiChangedError('Failed to set 头条首发 checkbox to the requested state.', {
      enabled,
      finalChecked
    });
  }
}

async function isByteCheckboxChecked(label: Locator): Promise<boolean> {
  return label.evaluate((el) => {
    const input = el.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    if (input?.checked) {
      return true;
    }
    return el.classList.contains('byte-checkbox-checked')
      || el.className.includes('checked')
      || el.getAttribute('aria-checked') === 'true';
  }).catch(() => false);
}

/**
 * Best-effort: set 添加位置 / city marker when the control exists.
 * Never throws — missing UI, geolocation prompts, or failed fill must not block publish.
 * Returns true only when a location appears to have been applied.
 *
 * Note: 添加至合集 is intentionally not automated (picker UX is account-specific
 * and multi-step); callers should omit collection flags.
 */
export async function setLocation(page: Page, location: string): Promise<boolean> {
  const value = location.trim();
  if (value === '') {
    return false;
  }

  try {
    await dismissBlockingOverlays(page);

    // Open the location picker if not already open.
    const openTriggers = [
      page.getByRole('button', { name: /添加位置/ }).first(),
      page.getByText('添加位置', { exact: false }).first(),
      page.locator('[class*="location"], [class*="Location"], [class*="poi"]')
        .filter({ hasText: /添加位置|位置|地点/ })
        .first(),
      page.getByText(/添加位置|标记位置|选择位置/, { exact: false }).first()
    ];

    let opened = false;
    for (const trigger of openTriggers) {
      if ((await trigger.count().catch(() => 0)) === 0) {
        continue;
      }
      if (!(await trigger.isVisible().catch(() => false))) {
        continue;
      }
      await trigger.click({ force: true, timeout: 5_000 }).catch(() => undefined);
      opened = true;
      await page.waitForTimeout(500);
      break;
    }

    // Search / city input inside the picker (or already visible on form).
    const searchCandidates = [
      page.locator('input[placeholder*="位置"]').first(),
      page.locator('input[placeholder*="地点"]').first(),
      page.locator('input[placeholder*="搜索位置"]').first(),
      page.locator('input[placeholder*="搜索"]').first(),
      page.locator(
        '[class*="location"] input, [class*="Location"] input, [class*="poi"] input, .byte-input input'
      ).first()
    ];

    let search: Locator | undefined;
    for (const candidate of searchCandidates) {
      if ((await candidate.count().catch(() => 0)) === 0) {
        continue;
      }
      if (!(await candidate.isVisible().catch(() => false))) {
        continue;
      }
      search = candidate;
      break;
    }

    if (search === undefined) {
      // No searchable control — if we never opened a picker, location is unavailable.
      if (!opened) {
        return false;
      }
      // Picker opened but no input: try selecting a visible suggestion by name.
      return await pickLocationSuggestion(page, value);
    }

    await search.click({ force: true, timeout: 3_000 }).catch(() => undefined);
    await search.fill(value);
    await page.waitForTimeout(800);

    const picked = await pickLocationSuggestion(page, value);
    if (picked) {
      return true;
    }

    // Last resort: confirm typed value with Enter (some UIs accept free text).
    await search.press('Enter').catch(() => undefined);
    await page.waitForTimeout(400);
    return true;
  } catch {
    return false;
  }
}

async function pickLocationSuggestion(page: Page, value: string): Promise<boolean> {
  const suggestion = page.locator(
    `[class*="location"] li, [class*="Location"] li, [class*="poi"] li, ` +
    `[role="option"], .byte-list-item, .byte-select-option, [class*="suggest"] li, ` +
    `[class*="dropdown"] li, [class*="Dropdown"] li`
  ).filter({ hasText: value }).first();

  if ((await suggestion.count().catch(() => 0)) > 0
    && await suggestion.isVisible().catch(() => false)) {
    await suggestion.click({ force: true, timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(300);
    return true;
  }

  // First generic list item after search (city marker may not match exact text).
  const firstItem = page.locator(
    `[class*="location"] li, [class*="poi"] li, [role="option"], .byte-list-item`
  ).first();
  if ((await firstItem.count().catch(() => 0)) > 0
    && await firstItem.isVisible().catch(() => false)) {
    await firstItem.click({ force: true, timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(300);
    return true;
  }

  return false;
}

/**
 * Select a 作品声明 option by visible label text (partial match OK).
 */
export async function setWorkClaim(page: Page, claim: string): Promise<void> {
  const value = claim.trim();
  if (value === '') {
    return;
  }

  await dismissBlockingOverlays(page);
  // Prefer checkbox labels under 作品声明 area.
  const claimLabel = page.locator('label.byte-checkbox', { hasText: value }).first();
  if ((await claimLabel.count()) > 0 && await claimLabel.isVisible().catch(() => false)) {
    const checked = await isByteCheckboxChecked(claimLabel);
    if (!checked) {
      await claimLabel.click({ force: true, timeout: 5_000 });
      await page.waitForTimeout(200);
    }
    return;
  }

  const text = page.getByText(value, { exact: false }).first();
  if ((await text.count()) > 0) {
    await text.click({ force: true, timeout: 5_000 });
    await page.waitForTimeout(200);
  }
}

/**
 * Insert a micro-post topic. Prefers toolbar 话题 picker; falls back to #topic# text.
 * Returns the text that should be present in the editor for verification.
 */
export async function applyMicroTopic(
  page: Page,
  topic: string
): Promise<string> {
  const normalized = topic.replace(/^#/, '').replace(/#$/, '').trim();
  if (normalized === '') {
    return '';
  }
  const hashtag = `#${normalized}#`;

  await page.keyboard.press('Escape').catch(() => undefined);
  const topicButton = page.getByRole('button', { name: '话题' }).first();
  if ((await topicButton.count()) > 0 && await topicButton.isVisible().catch(() => false)) {
    await topicButton.click({ force: true, timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(900);

    const search = page.locator(
      'input[placeholder*="话题"], input[placeholder*="搜索话题"], input[placeholder*="搜索"], input[placeholder*="输入"]'
    ).first();
    if ((await search.count()) > 0) {
      await search.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => undefined);
    }
    if ((await search.count()) > 0 && await search.isVisible().catch(() => false)) {
      await search.click({ force: true });
      await search.fill('');
      await search.type(normalized, { delay: 40 });
      await page.waitForTimeout(1_200);

      const suggestion = page.locator(
        `[class*="topic"] li, [class*="Topic"] li, [class*="tweet"] li, [role="option"], .byte-list-item, .byte-select-option`
      ).filter({ hasText: normalized }).first();
      if ((await suggestion.count()) > 0 && await suggestion.isVisible().catch(() => false)) {
        await suggestion.click({ force: true, timeout: 5_000 }).catch(() => undefined);
        await page.waitForTimeout(500);
        return hashtag;
      }

      // Create/use free-form topic via Enter when no suggestion.
      await page.keyboard.press('Enter').catch(() => undefined);
      await page.waitForTimeout(500);
      const editorAfter = page.locator('.ProseMirror').first();
      const text = await editorAfter.innerText().catch(() => '');
      if (text.includes(normalized) || text.includes('#')) {
        return hashtag;
      }
    }

    await page.keyboard.press('Escape').catch(() => undefined);
  }

  // Fallback: append #topic# with collapsed caret (never select-all).
  const editor = page.locator('.ProseMirror').first();
  await focusEditorEndCollapsed(page, editor);
  await page.keyboard.press('Enter').catch(() => undefined);
  await page.keyboard.type(hashtag, { delay: 20 });
  await page.waitForTimeout(300);
  return hashtag;
}

export function countContentChars(text: string): number {
  // Match console "字" roughly as JS code points (CJK included).
  return Array.from(text.replace(/\s+/g, '')).length;
}
