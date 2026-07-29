import type { Locator, Page } from 'playwright';

import { ToutiaoCommandError } from '../types.js';

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
  const locator = await firstVisibleLocator(page, selectors);
  if (locator === undefined) {
    throw uiChangedError(`Could not find the ${fieldName} field on the Toutiao creator console.`);
  }

  await locator.click({ timeout: 10_000 });
  const tagName = await locator.evaluate((node) => node.tagName.toLowerCase());
  if (tagName === 'input' || tagName === 'textarea') {
    await locator.fill(value);
    return;
  }

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
  for (const name of names) {
    const button = page.getByRole('button', { name });
    try {
      if ((await button.count()) === 0) {
        continue;
      }
      const target = button.first();
      if (await target.isVisible()) {
        await target.click({ timeout: 15_000 });
        return;
      }
    } catch {
      // Try next name.
    }
  }

  // Fallback: text locators for non-semantic buttons.
  for (const name of names) {
    const textButton = page.locator('button, [role="button"], a').filter({ hasText: name }).first();
    try {
      if ((await textButton.count()) > 0 && await textButton.isVisible()) {
        await textButton.click({ timeout: 15_000 });
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

export function uiChangedError(message: string, details?: unknown): ToutiaoCommandError {
  return new ToutiaoCommandError('TOUTIAO_UI_CHANGED', message, 1, details);
}

export async function setFirstFileInput(
  page: Page,
  selectors: readonly string[],
  filePath: string,
  fieldName: string
): Promise<void> {
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
