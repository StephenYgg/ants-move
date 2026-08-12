#!/usr/bin/env node
/**
 * Headed Xianyu (goofish) QR login + keyword search API discovery.
 *
 * Flow:
 * 1. Open headed Chrome on goofish.com
 * 2. Wait for you to scan QR / complete login
 * 3. Save Playwright storageState
 * 4. Open search for a keyword and capture mtop search JSON
 *
 * Usage:
 *   node scripts/xianyu-login-search-discovery.mjs [--keyword 单反] [--timeout-ms 180000]
 *
 * Does not bypass captchas or risk controls. Login is manual in the browser window.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function parseArgs(argv) {
  const out = {
    keyword: '单反',
    timeoutMs: 180_000,
    statePath: path.join(os.homedir(), '.config', 'ants-move', 'xianyu', 'default.json'),
    outDir: '/tmp/xianyu-discovery'
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--keyword') out.keyword = argv[++i] ?? out.keyword;
    else if (a === '--timeout-ms') out.timeoutMs = Number(argv[++i] ?? out.timeoutMs);
    else if (a === '--state') out.statePath = argv[++i] ?? out.statePath;
    else if (a === '--out-dir') out.outDir = argv[++i] ?? out.outDir;
  }
  return out;
}

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function launchBrowser() {
  try {
    return await chromium.launch({
      headless: false,
      channel: 'chrome',
      args: ['--disable-blink-features=AutomationControlled']
    });
  } catch (error) {
    log('chrome channel unavailable, falling back to bundled chromium:', error.message);
    return chromium.launch({ headless: false });
  }
}

function isSearchApi(url) {
  return url.includes('mtop.taobao.idlemtopsearch.pc.search/1.0');
}

function isSuccessRet(body) {
  if (!body || typeof body !== 'object') return false;
  const ret = body.ret;
  if (!Array.isArray(ret)) return false;
  return ret.some((item) => typeof item === 'string' && item.includes('SUCCESS'));
}

async function waitForLogin(page, timeoutMs) {
  const started = Date.now();
  log('Please scan the QR code / log in in the opened browser window...');
  log('Waiting up to', timeoutMs, 'ms');

  while (Date.now() - started < timeoutMs) {
    // Prefer loginuser API success via in-page fetch style cookies
    const cookies = await page.context().cookies();
    const names = new Set(cookies.map((c) => c.name));
    const hasSession =
      names.has('cookie2')
      || names.has('unb')
      || names.has('_m_h5_tk')
      || names.has('sgcookie')
      || names.has('tracknick')
      || [...names].some((n) => /token|sid|login/i.test(n));

    // DOM heuristic: login iframe/popup gone and avatar/user area present
    const loggedInUi = await page.evaluate(() => {
      const text = document.body?.innerText ?? '';
      if (/扫码登录|手机号登录|请登录|登录闲鱼/.test(text) && !/退出|我的|消息/.test(text)) {
        return false;
      }
      // cookie banner alone is not enough
      return Boolean(
        document.querySelector('[class*="avatar"], [class*="user"], img[alt*="头像"]')
        || /退出登录|我的闲鱼|卖闲置/.test(text)
      );
    }).catch(() => false);

    if (hasSession && loggedInUi) {
      log('Login heuristics matched (session cookies + UI).');
      return true;
    }

    // Secondary: hit loginuser endpoint from page context
    try {
      const probe = await page.evaluate(async () => {
        const t = Date.now();
        const url =
          `https://h5api.m.goofish.com/h5/mtop.taobao.idlemessage.pc.loginuser.get/1.0/`
          + `?jsv=2.7.2&appKey=34839810&t=${t}&v=1.0&type=originaljson`
          + `&accountSite=xianyu&dataType=json&timeout=20000`
          + `&api=mtop.taobao.idlemessage.pc.loginuser.get&sessionOption=AutoLoginOnly`;
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            referer: 'https://www.goofish.com/'
          },
          body: 'data=%7B%7D'
        });
        const text = await res.text();
        return text.slice(0, 500);
      });
      if (probe.includes('SUCCESS') && !probe.includes('SESSION_EXPIRED') && !probe.includes('TOKEN_EMPTY')) {
        log('loginuser probe SUCCESS');
        return true;
      }
    } catch {
      // ignore probe failures while waiting
    }

    await page.waitForTimeout(2000);
  }
  throw new Error(`Login timed out after ${timeoutMs}ms`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(path.dirname(options.statePath), { recursive: true, mode: 0o700 });
  fs.mkdirSync(options.outDir, { recursive: true });

  const browser = await launchBrowser();
  const context = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 1360, height: 900 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  const captured = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (!isSearchApi(url)) return;
    let bodyText = '';
    try {
      bodyText = await response.text();
    } catch {
      bodyText = '';
    }
    let bodyJson = null;
    try {
      bodyJson = JSON.parse(bodyText);
    } catch {
      bodyJson = null;
    }
    const entry = {
      status: response.status(),
      url,
      bodyText: bodyText.slice(0, 2_000_000),
      success: isSuccessRet(bodyJson),
      at: new Date().toISOString()
    };
    captured.push(entry);
    log('search API response', entry.status, 'success=', entry.success, 'len=', bodyText.length);
    fs.writeFileSync(
      path.join(options.outDir, `search-response-${captured.length}.json`),
      bodyText || '{}'
    );
  });

  try {
    log('Opening https://www.goofish.com/');
    await page.goto('https://www.goofish.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.screenshot({ path: path.join(options.outDir, '01-home.png') });

    // Click login if visible
    const loginBtn = page.getByRole('button', { name: /登录/ }).first();
    if (await loginBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await loginBtn.click().catch(() => undefined);
    } else {
      const loginLink = page.locator('text=登录').first();
      if (await loginLink.isVisible({ timeout: 2000 }).catch(() => false)) {
        await loginLink.click().catch(() => undefined);
      }
    }

    await waitForLogin(page, options.timeoutMs);
    await page.screenshot({ path: path.join(options.outDir, '02-logged-in.png') });

    await context.storageState({ path: options.statePath });
    fs.chmodSync(options.statePath, 0o600);
    log('Saved storageState to', options.statePath);

    const searchUrl = `https://www.goofish.com/search?q=${encodeURIComponent(options.keyword)}`;
    log('Opening search', searchUrl);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // Allow SPA + mtop calls
    await page.waitForTimeout(8000);
    // Scroll to trigger more loads
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(options.outDir, '03-search.png'), fullPage: true });

    const success = captured.filter((c) => c.success);
    const summary = {
      keyword: options.keyword,
      statePath: options.statePath,
      outDir: options.outDir,
      capturedCount: captured.length,
      successCount: success.length,
      latestSuccessFile: success.length
        ? path.join(options.outDir, `search-response-${captured.indexOf(success[success.length - 1]) + 1}.json`)
        : null,
      sampleRet: (() => {
        try {
          return JSON.parse(captured[captured.length - 1]?.bodyText || '{}').ret;
        } catch {
          return null;
        }
      })()
    };
    fs.writeFileSync(path.join(options.outDir, 'summary.json'), JSON.stringify(summary, null, 2));
    log('SUMMARY', JSON.stringify(summary, null, 2));

    if (success.length === 0) {
      log('No SUCCESS search payload yet. State is saved; re-run after login if needed.');
      process.exitCode = 2;
    } else {
      // Print a compact item preview if shape is known
      try {
        const body = JSON.parse(success[success.length - 1].bodyText);
        const data = body.data ?? {};
        const preview = JSON.stringify(data).slice(0, 1500);
        log('SUCCESS data preview:', preview);
      } catch {
        // ignore
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
