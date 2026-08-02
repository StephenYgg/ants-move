import type { Locator, Page } from 'playwright';

import { ToutiaoCommandError } from '../types.js';

export async function dismissBlockingOverlays(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(150);
  }

  await page.evaluate(() => {
    const selectors = [
      '.byte-drawer-mask',
      '.byte-drawer-wrapper.ai-assistant-drawer',
      '.ai-assistant-drawer'
    ];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        (node as HTMLElement).style.pointerEvents = 'none';
        (node as HTMLElement).style.display = 'none';
      }
    }
  }).catch(() => undefined);
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
      await locator.fill(value, { timeout: 15_000 });
      return;
    }

    await locator.click({ timeout: 10_000, force: true });
    const html = textToEditorHtml(value);
    await locator.evaluate((node, htmlContent) => {
      const element = node as HTMLElement;
      element.focus();
      if (element.getAttribute('contenteditable') === 'true') {
        element.innerHTML = htmlContent;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      element.textContent = htmlContent;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }, html);
  } catch (error) {
    throw mapPlaywrightError(error, `Failed to fill ${fieldName} on the Toutiao creator console.`);
  }
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

  // Fallback: text locators for non-semantic buttons.
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

export async function waitForDraftAutosave(page: Page): Promise<void> {
  // profile_v4 graphic editor auto-saves drafts; there is often no "save draft" button.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const text = await page.locator('body').innerText().catch(() => '');
    if (
      text.includes('草稿保存中')
      || text.includes('草稿已保存')
      || text.includes('已保存至草稿')
      || text.includes('保存成功')
    ) {
      // Give the save request a moment to finish after the toast appears.
      await page.waitForTimeout(1500);
      return;
    }
    await page.waitForTimeout(500);
  }

  // Autosave may be silent after edits; do not hard-fail if form was filled.
  await page.waitForTimeout(2000);
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
