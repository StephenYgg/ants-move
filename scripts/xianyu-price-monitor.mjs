#!/usr/bin/env node
/**
 * Monitor top-N prices for a Xianyu keyword every intervalMs for durationMs.
 * Uses one headed browser session so user can pass risk challenge once.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const keyword = process.argv[2] || '单反 兔笼';
const topN = Number(process.argv[3] || 10);
const intervalMs = Number(process.argv[4] || 5000);
const durationMs = Number(process.argv[5] || 180000);
const statePath = path.join(os.homedir(), '.config/ants-move/xianyu/default.json');
const outDir = '/tmp/xianyu-monitor';
fs.mkdirSync(outDir, { recursive: true });

function log(...a) { console.log(new Date().toISOString(), ...a); }

function isSearchApi(url) {
  return url.includes('mtop.taobao.idlemtopsearch.pc.search/1.0');
}

function isSuccess(body) {
  return Array.isArray(body?.ret) && body.ret.some((x) => String(x).includes('SUCCESS'));
}

function extractTop(body, n) {
  const list = body?.data?.resultList || [];
  const items = [];
  for (const entry of list) {
    if (items.length >= n) break;
    try {
      const ex = entry.data.item.main.exContent;
      const detail = ex.detailParams || {};
      let priceNum = detail.soldPrice ?? detail.price;
      if (priceNum === undefined && Array.isArray(ex.price)) {
        priceNum = ex.price.map((p) => p.text || '').join('').replace(/[^\d.]/g, '');
      }
      const num = Number(priceNum);
      items.push({
        itemId: String(ex.itemId || detail.itemId || ''),
        title: String(ex.title || detail.title || ''),
        price: Number.isFinite(num) ? num : null,
        priceRaw: String(priceNum ?? ''),
        area: ex.area || ''
      });
    } catch {}
  }
  return items;
}

const browser = await chromium.launch({
  headless: false,
  channel: 'chrome',
  args: ['--disable-blink-features=AutomationControlled']
}).catch(() => chromium.launch({ headless: false }));

const context = await browser.newContext({
  locale: 'zh-CN',
  storageState: statePath,
  viewport: { width: 1360, height: 900 }
});
const page = await context.newPage();
const samples = [];
let lastSuccessAt = 0;

async function captureOnce(label) {
  return new Promise(async (resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve({ ok: false, error: 'timeout', items: [] });
      }
    }, 25000);

    const onResp = async (res) => {
      if (done || !isSearchApi(res.url()) || res.status() !== 200) return;
      let body;
      try { body = await res.json(); } catch { return; }
      if (!isSuccess(body)) {
        // keep waiting for success if risk page
        return;
      }
      if (done) return;
      done = true;
      clearTimeout(timer);
      page.off('response', onResp);
      const items = extractTop(body, topN);
      resolve({ ok: true, items, ret: body.ret });
    };
    page.on('response', onResp);

    try {
      const url = `https://www.goofish.com/search?q=${encodeURIComponent(keyword)}&_ts=${Date.now()}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      // gentle scroll to encourage load
      await page.waitForTimeout(2000);
      await page.mouse.wheel(0, 800);
    } catch (e) {
      if (!done) {
        done = true;
        clearTimeout(timer);
        page.off('response', onResp);
        resolve({ ok: false, error: e.message, items: [] });
      }
    }
  });
}

log(`Monitor start keyword="${keyword}" topN=${topN} every ${intervalMs}ms for ${durationMs}ms`);
log('If risk challenge appears, complete it in the browser window.');

// First sample: allow up to 90s for challenge
const firstDeadline = Date.now() + 90000;
let first = null;
while (Date.now() < firstDeadline) {
  first = await captureOnce('warmup');
  if (first.ok && first.items.length) break;
  log('warmup not ready:', first.error || 'no SUCCESS yet; waiting for challenge pass...');
  await page.waitForTimeout(5000);
}

if (!first?.ok || !first.items.length) {
  log('Failed to get first successful sample within 90s. Aborting monitor.');
  await context.storageState({ path: statePath }).catch(() => {});
  await browser.close();
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({
    keyword, ok: false, reason: 'no_successful_sample', samples: []
  }, null, 2));
  process.exit(2);
}

const t0 = Date.now();
let sampleIndex = 0;
const pushSample = (result) => {
  sampleIndex += 1;
  const prices = result.items.map((i) => i.price).filter((p) => p != null);
  const row = {
    index: sampleIndex,
    at: new Date().toISOString(),
    elapsedSec: Math.round((Date.now() - t0) / 1000),
    ok: result.ok,
    count: result.items.length,
    prices,
    min: prices.length ? Math.min(...prices) : null,
    max: prices.length ? Math.max(...prices) : null,
    avg: prices.length ? Number((prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2)) : null,
    items: result.items
  };
  samples.push(row);
  log(`#${sampleIndex} min=${row.min} max=${row.max} avg=${row.avg} prices=${prices.join(',')}`);
  fs.writeFileSync(path.join(outDir, `sample-${sampleIndex}.json`), JSON.stringify(row, null, 2));
};

pushSample(first);
lastSuccessAt = Date.now();

while (Date.now() - t0 < durationMs) {
  const nextAt = t0 + sampleIndex * intervalMs;
  const wait = Math.max(0, nextAt - Date.now());
  if (wait > 0) await page.waitForTimeout(wait);
  if (Date.now() - t0 >= durationMs) break;
  const result = await captureOnce(`sample-${sampleIndex + 1}`);
  if (result.ok && result.items.length) {
    pushSample(result);
    lastSuccessAt = Date.now();
  } else {
    sampleIndex += 1;
    const row = {
      index: sampleIndex,
      at: new Date().toISOString(),
      elapsedSec: Math.round((Date.now() - t0) / 1000),
      ok: false,
      error: result.error || 'no SUCCESS',
      count: 0,
      prices: [],
      min: null, max: null, avg: null,
      items: []
    };
    samples.push(row);
    log(`#${sampleIndex} FAIL ${row.error}`);
    fs.writeFileSync(path.join(outDir, `sample-${sampleIndex}.json`), JSON.stringify(row, null, 2));
  }
}

await context.storageState({ path: statePath }).catch(() => {});
await browser.close();

const okSamples = samples.filter((s) => s.ok && s.prices.length);
const allPrices = okSamples.flatMap((s) => s.prices);
const mins = okSamples.map((s) => s.min).filter((x) => x != null);
const maxs = okSamples.map((s) => s.max).filter((x) => x != null);
const avgs = okSamples.map((s) => s.avg).filter((x) => x != null);

// rank stability: itemId frequency in top10
const idFreq = new Map();
const idMeta = new Map();
for (const s of okSamples) {
  for (const it of s.items) {
    if (!it.itemId) continue;
    idFreq.set(it.itemId, (idFreq.get(it.itemId) || 0) + 1);
    idMeta.set(it.itemId, it);
  }
}
const topStable = [...idFreq.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .map(([id, freq]) => ({
    itemId: id,
    appearInSamples: freq,
    appearRate: Number((freq / okSamples.length).toFixed(2)),
    title: idMeta.get(id)?.title,
    lastPrice: idMeta.get(id)?.price
  }));

const report = {
  keyword,
  topN,
  intervalMs,
  durationMs,
  startedAt: samples[0]?.at,
  endedAt: samples[samples.length - 1]?.at,
  totalSamples: samples.length,
  successSamples: okSamples.length,
  failSamples: samples.length - okSamples.length,
  priceSummary: {
    overallMin: mins.length ? Math.min(...mins) : null,
    overallMax: maxs.length ? Math.max(...maxs) : null,
    avgOfSampleMins: mins.length ? Number((mins.reduce((a, b) => a + b, 0) / mins.length).toFixed(2)) : null,
    avgOfSampleAvgs: avgs.length ? Number((avgs.reduce((a, b) => a + b, 0) / avgs.length).toFixed(2)) : null,
    avgOfSampleMaxs: maxs.length ? Number((maxs.reduce((a, b) => a + b, 0) / maxs.length).toFixed(2)) : null,
    allPricesCount: allPrices.length
  },
  timeline: samples.map((s) => ({
    index: s.index,
    at: s.at,
    elapsedSec: s.elapsedSec,
    ok: s.ok,
    min: s.min,
    avg: s.avg,
    max: s.max,
    prices: s.prices,
    error: s.error
  })),
  topStableItems: topStable,
  firstTop10: okSamples[0]?.items || [],
  lastTop10: okSamples[okSamples.length - 1]?.items || []
};

fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
log('REPORT_WRITTEN', path.join(outDir, 'report.json'));
console.log(JSON.stringify(report, null, 2));
