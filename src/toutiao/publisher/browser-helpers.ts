import type { BrowserContext, Locator, Page } from 'playwright';

import { TOUTIAO_MP_ORIGIN } from './form-map.js';
import { ToutiaoCommandError } from '../types.js';

/** Permissions the creator console may request; grant all by default. */
export const TOUTIAO_SITE_PERMISSIONS = [
  'geolocation',
  'notifications',
  'camera',
  'microphone',
  'clipboard-read',
  'clipboard-write'
] as const;

/**
 * Allow the Toutiao creator origin to use browser APIs without interactive prompts.
 * Safe no-op when the context already granted them or CDP rejects a permission name.
 */
export async function grantCreatorSitePermissions(
  target: Page | BrowserContext
): Promise<void> {
  // Page has context(); BrowserContext is the grant target itself.
  const context = typeof (target as Page).context === 'function'
    && typeof (target as Page).goto === 'function'
    ? (target as Page).context()
    : target as BrowserContext;

  await context.grantPermissions([...TOUTIAO_SITE_PERMISSIONS], {
    origin: TOUTIAO_MP_ORIGIN
  }).catch(() => undefined);

  // Some Chromium builds also need the bare www origin for shared widgets.
  await context.grantPermissions([...TOUTIAO_SITE_PERMISSIONS], {
    origin: 'https://www.toutiao.com'
  }).catch(() => undefined);
}

/**
 * Prepare the creator page before fill/save:
 * grant site permissions, dismiss permission UI, remove right-side blockers.
 */
export async function prepareCreatorPage(page: Page): Promise<void> {
  await grantCreatorSitePermissions(page);
  await dismissBlockingOverlays(page);
}

/**
 * Dismiss permission prompts and remove overlays that block editor + 存草稿.
 * Includes AI drawers, draft tips, top-right zoom chrome, and right-side panels.
 */
export async function dismissBlockingOverlays(page: Page): Promise<void> {
  await acceptInPagePermissionPrompts(page);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(120);
  }

  await page.evaluate(() => {
    const hide = (node: Element | null | undefined): void => {
      if (node === null || node === undefined) {
        return;
      }
      const el = node as HTMLElement;
      el.style.setProperty('pointer-events', 'none', 'important');
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('visibility', 'hidden', 'important');
      el.setAttribute('aria-hidden', 'true');
    };

    const knownSelectors = [
      // Only AI assistant drawers — never hide image-upload drawers (mp-ic-img-drawer).
      '.byte-drawer-wrapper.ai-assistant-drawer',
      '.ai-assistant-drawer',
      '.ai-assistant.is-drawer',
      '.draft-tip-close-icon',
      '.draft-tip',
      '.draft-tip-wrapper',
      '[class*="zoom-panel"]',
      '[class*="ZoomPanel"]',
      '[class*="zoom-control"]',
      '[class*="scale-control"]',
      '[class*="preview-scale"]',
      '.byte-notification-wrapper',
      '[class*="permission"]',
      '[class*="Permission"]'
    ];
    for (const selector of knownSelectors) {
      for (const node of document.querySelectorAll(selector)) {
        // Keep image library / media drawers interactive.
        if (
          node.closest('.mp-ic-img-drawer')
          || node.classList.contains('mp-ic-img-drawer')
          || /img-drawer|image-drawer|ic-img/i.test(String(node.className))
        ) {
          continue;
        }
        hide(node);
      }
    }

    // Hide fixed/sticky right-side chrome that covers the editor or footer.
    // Keep the main ProseMirror editor and footer action bar intact.
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const candidates = document.querySelectorAll('body *');
    for (const node of candidates) {
      const el = node as HTMLElement;
      if (!(el instanceof HTMLElement)) {
        continue;
      }
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') {
        continue;
      }
      const position = style.position;
      if (position !== 'fixed' && position !== 'sticky' && position !== 'absolute') {
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 40) {
        continue;
      }
      // Right-edge strip (zoom / AI / side tools), top-right floating chrome.
      const onRight = rect.left > viewportWidth * 0.62;
      const topRight =
        rect.top < viewportHeight * 0.35
        && rect.right > viewportWidth * 0.7
        && rect.width < viewportWidth * 0.45;
      if (!onRight && !topRight) {
        continue;
      }
      // Never hide the real editor, footer actions, or image-upload drawer.
      if (
        el.closest('.ProseMirror')
        || el.classList.contains('ProseMirror')
        || el.closest('[class*="footer"]')
        || el.closest('.mp-ic-img-drawer')
        || el.closest('.primary-drawer')
        || el.classList.contains('mp-ic-img-drawer')
        || /存草稿|发布|预览|本地上传|上传图片/.test(el.innerText ?? '')
      ) {
        continue;
      }
      const text = (el.innerText ?? '').replace(/\s+/g, ' ').trim();
      const className = String(el.className ?? '');
      const looksLikeZoomOrSide =
        /缩放|放大|缩小|100%|75%|125%|AI|助手|创作助手|侧栏|面板/.test(text)
        || /zoom|scale|assistant|drawer|side[-_]?panel|right[-_]?panel/i.test(className)
        || (onRight && rect.height > viewportHeight * 0.35);
      if (looksLikeZoomOrSide) {
        hide(el);
      }
    }
  }).catch(() => undefined);

  // Click explicit close controls when present (draft tip / drawer close / X).
  const closeSelectors = [
    '.draft-tip-close-icon',
    '.byte-drawer-close',
    '.byte-icon-close',
    '[class*="drawer"] [class*="close"]',
    '[class*="side-panel"] [class*="close"]',
    '[aria-label="关闭"]',
    '[aria-label="Close"]',
    'button:has-text("关闭")'
  ];
  for (const selector of closeSelectors) {
    const close = page.locator(selector).first();
    if ((await close.count().catch(() => 0)) > 0) {
      await close.click({ force: true, timeout: 1_500 }).catch(() => undefined);
    }
  }

  // Accept residual permission buttons after DOM cleanup.
  await acceptInPagePermissionPrompts(page);
}

/**
 * Click "允许 / 始终允许 / Allow" on in-page permission dialogs.
 * Browser-native bubbles are handled via grantCreatorSitePermissions.
 */
async function acceptInPagePermissionPrompts(page: Page): Promise<void> {
  const allowNames = [
    /^始终允许$/,
    /^允许全部$/,
    /^全部允许$/,
    /^允许$/,
    /^同意$/,
    /^Always allow$/i,
    /^Allow$/i,
    /^Allow all$/i
  ];

  for (const name of allowNames) {
    const buttons = page.getByRole('button', { name });
    const count = await buttons.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const button = buttons.nth(index);
      if (await button.isVisible().catch(() => false)) {
        await button.click({ force: true, timeout: 2_000 }).catch(() => undefined);
      }
    }

    // Non-semantic clickable nodes used by some Toutiao modals.
    const textNodes = page.locator('button, [role="button"], a, span, div').filter({
      hasText: name
    });
    const textCount = await textNodes.count().catch(() => 0);
    for (let index = 0; index < Math.min(textCount, 4); index += 1) {
      const node = textNodes.nth(index);
      const box = await node.boundingBox().catch(() => null);
      if (box === null || box.width < 24 || box.height < 12) {
        continue;
      }
      // Prefer compact controls (permission chips), not full-page containers.
      if (box.width > 360 || box.height > 80) {
        continue;
      }
      await node.click({ force: true, timeout: 1_500 }).catch(() => undefined);
    }
  }
}

/**
 * Prevent the editor from auto-loading an existing draft into the form.
 * We still allow draft_list reads for UI, but block article/edit hydration.
 */
export async function blockExistingArticleDraftHydration(page: Page): Promise<void> {
  await page.route('**/mp/agw/article/edit**', async (route) => {
    await route.abort();
  });
}

export async function firstVisibleLocator(
  page: Page,
  selectors: readonly string[]
): Promise<Locator | undefined> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if ((await locator.count()) > 0 && await locator.isVisible()) {
        return locator;
      }
    } catch {
      // Try the next selector.
    }
  }

  return undefined;
}

export async function fillFirstMatch(
  page: Page,
  selectors: readonly string[],
  value: string,
  fieldName: string
): Promise<void> {
  await dismissBlockingOverlays(page);
  const locator = await firstVisibleLocator(page, selectors);
  if (locator === undefined) {
    throw uiChangedError(`Could not find the ${fieldName} field on the Toutiao creator console.`);
  }

  try {
    const tagName = await locator.evaluate((node) => node.tagName.toLowerCase());
    if (tagName === 'input' || tagName === 'textarea') {
      await locator.click({ timeout: 10_000, force: true });
      await locator.fill(value, { timeout: 15_000 });
      // Nudge framework listeners after programmatic fill.
      await locator.evaluate((node) => {
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
        node.dispatchEvent(new Event('blur', { bubbles: true }));
      });
      return;
    }

    await fillContentEditable(page, locator, value);
  } catch (error) {
    throw mapPlaywrightError(error, `Failed to fill ${fieldName} on the Toutiao creator console.`);
  }
}

async function fillContentEditable(
  page: Page,
  locator: Locator,
  value: string
): Promise<void> {
  await locator.click({ timeout: 10_000, force: true });
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+A`).catch(() => undefined);
  await page.keyboard.press('Backspace').catch(() => undefined);

  // Prefer a single keyboard.type call — this reliably triggers Toutiao autosave.
  const normalized = value.replace(/\n{2,}/g, '\n\n').trim();
  await page.keyboard.type(normalized, { delay: 20 });
  await page.waitForTimeout(300);
}

export function textToEditorHtml(value: string): string {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => {
      const escaped = paragraph
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll('\n', '<br>');
      return `<p>${escaped}</p>`;
    })
    .join('');
}

export async function clickButtonByNames(
  page: Page,
  names: readonly RegExp[],
  actionLabel: string
): Promise<void> {
  await dismissBlockingOverlays(page);

  for (const name of names) {
    const button = page.getByRole('button', { name });
    try {
      if ((await button.count()) === 0) {
        continue;
      }
      const target = button.first();
      if (await target.isVisible()) {
        await target.click({ timeout: 15_000, force: true });
        return;
      }
    } catch {
      // Try next name.
    }
  }

  for (const name of names) {
    const textButton = page.locator('button, [role="button"], a, span, div')
      .filter({ hasText: name })
      .first();
    try {
      if ((await textButton.count()) > 0 && await textButton.isVisible()) {
        await textButton.click({ timeout: 15_000, force: true });
        return;
      }
    } catch {
      // Try next.
    }
  }

  throw uiChangedError(
    `Could not find the ${actionLabel} control on the Toutiao creator console.`
  );
}

/**
 * Click the micro-post footer "存草稿" button with a human-like mouse path.
 */
export async function clickMicroSaveDraftButton(page: Page): Promise<void> {
  await dismissBlockingOverlays(page);

  const candidates = page.locator('button, [role="button"], span, div, a').filter({
    hasText: /^存草稿$/
  });
  const count = await candidates.count();
  if (count === 0) {
    throw uiChangedError('Could not find the micro-post "存草稿" button.');
  }

  // Prefer the last visible footer control (there can be duplicate text nodes).
  for (let index = count - 1; index >= 0; index -= 1) {
    const candidate = candidates.nth(index);
    const box = await candidate.boundingBox().catch(() => null);
    if (box === null || box.width < 20 || box.height < 10) {
      continue;
    }

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
    await page.waitForTimeout(120);
    await page.mouse.down();
    await page.waitForTimeout(40);
    await page.mouse.up();
    return;
  }

  throw uiChangedError('Could not find a visible micro-post "存草稿" button.');
}

/**
 * Click the top-left back control next to "发布文章" to trigger leave/save flow.
 */
export async function clickEditorBackControl(page: Page): Promise<boolean> {
  await dismissBlockingOverlays(page);

  // Observed: 24x24 SVG near left:32 top:20 beside the "发布文章" label.
  const headerBack = page.locator('.menu-tab-stick-header-fixer svg, .menu-tab-stick-header-wrapper svg').first();
  if ((await headerBack.count()) > 0) {
    try {
      await headerBack.click({ timeout: 5_000, force: true });
      return true;
    } catch {
      // Fall through.
    }
  }

  try {
    await page.mouse.click(44, 32);
    return true;
  } catch {
    return false;
  }
}

export function uiChangedError(message: string, details?: unknown): ToutiaoCommandError {
  return new ToutiaoCommandError('TOUTIAO_UI_CHANGED', message, 1, details);
}

export function mapPlaywrightError(error: unknown, message: string): ToutiaoCommandError {
  if (error instanceof ToutiaoCommandError) {
    return error;
  }

  const rawMessage = error instanceof Error ? error.message : String(error);
  if (/Timeout/i.test(rawMessage) || /intercepts pointer events/i.test(rawMessage)) {
    return new ToutiaoCommandError(
      'TOUTIAO_UI_CHANGED',
      message,
      1,
      { cause: rawMessage }
    );
  }

  return new ToutiaoCommandError(
    'TOUTIAO_PUBLISH_REJECTED',
    message,
    1,
    { cause: rawMessage }
  );
}

export async function setFirstFileInput(
  page: Page,
  selectors: readonly string[],
  filePath: string,
  fieldName: string
): Promise<void> {
  await dismissBlockingOverlays(page);
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if ((await locator.count()) === 0) {
        continue;
      }
      await locator.setInputFiles(filePath);
      return;
    } catch {
      // Try next file input.
    }
  }

  throw uiChangedError(`Could not find a file input for ${fieldName}.`, { filePath });
}
