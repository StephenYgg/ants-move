import type { Command } from 'commander';
import { z } from 'zod';

import { XianyuAuthService } from './auth.js';
import {
  renderXianyuAuthStatusAsJson,
  renderXianyuCommandErrorAsJson,
  renderXianyuSearchAsJson,
  renderXianyuSearchAsTable
} from './output.js';
import type { XianyuRuntime } from './runtime.js';
import { createDefaultXianyuRuntime } from './runtime.js';
import {
  parseNonNegativeNumber,
  parsePublishDays,
  parseQuickFilters,
  resolveSortPreset,
  type XianyuQuickFilterKey
} from './search-filters.js';
import { XianyuService } from './service.js';
import { XianyuCommandError } from './types.js';

export interface XianyuCommandDependencies {
  runtime?: XianyuRuntime;
  stderr: (value: string) => void;
  stdout: (value: string) => void;
}

const browserChannelSchema = z.enum(['chrome', 'msedge', 'chromium']).optional();

const authLoginOptionsSchema = z.object({
  browser: browserChannelSchema,
  state: z.string().optional(),
  timeoutMs: z.number().int().positive().default(5 * 60 * 1000)
});

const authStateOptionsSchema = z.object({
  browser: browserChannelSchema,
  headed: z.boolean().default(false),
  state: z.string().optional()
});

const searchOptionsSchema = z.object({
  appraise: z.boolean().default(false),
  area: z.string().optional(),
  brand: z.string().optional(),
  brandVid: z.string().optional(),
  browser: browserChannelSchema,
  city: z.string().optional(),
  distance: z.string().optional(),
  excludeMultiPlaces: z.boolean().default(false),
  format: z.enum(['json', 'table']).default('json'),
  freePostage: z.boolean().default(false),
  headed: z.boolean().default(false),
  lat: z.string().optional(),
  lng: z.string().optional(),
  maxPrice: z.string().optional(),
  minPrice: z.string().optional(),
  new: z.boolean().default(false),
  pages: z.number().int().min(1).max(5).default(1),
  personal: z.boolean().default(false),
  province: z.string().optional(),
  publishDays: z.string().optional(),
  quickFilter: z.string().optional(),
  sort: z.string().optional(),
  state: z.string().optional(),
  table: z.boolean().optional(),
  transport: z.enum(['api', 'browser']).default('api')
});

export function registerXianyuCommands(
  program: Command,
  dependencies: XianyuCommandDependencies
): void {
  const runtime = dependencies.runtime ?? createDefaultXianyuRuntime();
  const authService = new XianyuAuthService(runtime);
  const searchService = new XianyuService(runtime);

  const xianyu = program
    .command('xianyu')
    .description('Search Xianyu (goofish) listings with a logged-in session.');

  const auth = xianyu.command('auth').description('Manage Xianyu login state.');

  auth
    .command('login')
    .description('Open a headed browser, complete QR login, save storageState.')
    .option('--browser <browser>', 'chrome (default), msedge, or chromium')
    .option('--state <path>', 'Playwright storageState path')
    .option('--timeout-ms <ms>', 'login timeout in milliseconds', (value) => Number(value))
    .action(async (options) => {
      const parsed = authLoginOptionsSchema.parse({
        ...options,
        timeoutMs: options.timeoutMs === undefined ? undefined : Number(options.timeoutMs)
      });
      const result = await authService.login({
        ...(parsed.browser === undefined ? {} : { browser: parsed.browser }),
        ...(parsed.state === undefined ? {} : { statePath: parsed.state }),
        timeoutMs: parsed.timeoutMs
      });
      dependencies.stdout(`${renderXianyuAuthStatusAsJson(result)}\n`);
    });

  auth
    .command('status')
    .description('Check whether the saved Xianyu session is still logged in.')
    .option('--browser <browser>', 'chrome (default), msedge, or chromium')
    .option('--state <path>', 'Playwright storageState path')
    .option('--headed', 'show the browser while checking status')
    .action(async (options) => {
      const parsed = authStateOptionsSchema.parse(options);
      const result = await authService.status({
        ...(parsed.browser === undefined ? {} : { browser: parsed.browser }),
        ...(parsed.state === undefined ? {} : { statePath: parsed.state }),
        headed: parsed.headed
      });
      dependencies.stdout(`${renderXianyuAuthStatusAsJson(result)}\n`);
    });

  auth
    .command('logout')
    .description('Remove the local Xianyu auth state file only.')
    .option('--state <path>', 'Playwright storageState path')
    .action(async (options) => {
      const parsed = z.object({ state: z.string().optional() }).parse(options);
      const result = await authService.logout({
        ...(parsed.state === undefined ? {} : { statePath: parsed.state })
      });
      dependencies.stdout(`${renderXianyuAuthStatusAsJson(result)}\n`);
    });

  xianyu
    .command('search')
    .description(
      'Search Xianyu listings by keyword (requires auth state). Default transport is pure MTOP API. Supports PC advanced filters.'
    )
    .argument('<keyword>', 'search keyword, e.g. 单反')
    .option('--pages <pages>', 'number of pages to fetch (1..5)', (value) => Number(value), 1)
    .option('--format <format>', 'json (default) or table')
    .option('-t, --table', 'render as a table')
    .option(
      '--transport <transport>',
      'api (default, pure MTOP HTTP) or browser (Playwright intercept)',
      'api'
    )
    .option(
      '--sort <sort>',
      'default|price_asc|price_desc|newest|oldest|distance|credit'
    )
    .option(
      '--brand <name>',
      'brand name from PC facets, e.g. 佳能 or Canon (auto-resolves vid)'
    )
    .option('--brand-vid <vid>', 'brand facet vid (skip name resolution)')
    .option('--min-price <n>', 'minimum price (yuan)')
    .option('--max-price <n>', 'maximum price (yuan)')
    .option('--publish-days <n>', 'listed within N days: 1|3|7|14')
    .option(
      '--quick-filter <csv>',
      'csv of: personal,free_postage,new,appraise,high_level_seller,inspected,resell,game_account'
    )
    .option('--personal', 'shortcut for personal idle (个人闲置)')
    .option('--free-postage', 'shortcut for free postage (包邮)')
    .option('--new', 'shortcut for brand-new (全新)')
    .option('--appraise', 'shortcut for inspected goods (验货宝)')
    .option('--province <name>', 'province for location filter, e.g. 广东')
    .option('--city <name>', 'city for location filter, e.g. 深圳')
    .option('--area <name>', 'district/area, e.g. 南山区')
    .option('--exclude-multi-places', 'exclude multi-location sellers')
    .option('--lat <n>', 'latitude (use with --lng)')
    .option('--lng <n>', 'longitude (use with --lat)')
    .option('--distance <meters>', 'distance range in meters (with --lat/--lng)')
    .option('--browser <browser>', 'chrome (default), msedge, or chromium (browser transport)')
    .option('--state <path>', 'Playwright storageState path')
    .option('--headed', 'show the browser while searching (browser transport only)')
    .action(async (keyword, options) => {
      const parsed = searchOptionsSchema.parse({
        ...options,
        pages: options.pages === undefined ? 1 : Number(options.pages)
      });
      const format = parsed.table ? 'table' : parsed.format;
      const filters = buildFiltersFromCli(parsed);
      const result = await searchService.search({
        keyword,
        pages: parsed.pages,
        headed: parsed.headed,
        transport: parsed.transport,
        ...(parsed.browser === undefined ? {} : { browser: parsed.browser }),
        ...(parsed.state === undefined ? {} : { statePath: parsed.state }),
        ...(filters === undefined ? {} : { filters }),
        ...(parsed.brand === undefined ? {} : { brand: parsed.brand.trim() }),
        ...(parsed.brandVid === undefined ? {} : { brandVid: parsed.brandVid.trim() })
      });
      if (format === 'table') {
        dependencies.stdout(`${renderXianyuSearchAsTable(result)}\n`);
      } else {
        dependencies.stdout(`${renderXianyuSearchAsJson(result)}\n`);
      }
    });
}

function buildFiltersFromCli(parsed: z.infer<typeof searchOptionsSchema>):
  | Omit<import('./search-filters.js').XianyuSearchFilterOptions, 'keyword' | 'pageNumber' | 'rowsPerPage'>
  | undefined {
  const quick = new Set<XianyuQuickFilterKey>(parseQuickFilters(parsed.quickFilter));
  if (parsed.personal) {
    quick.add('personal');
  }
  if (parsed.freePostage) {
    quick.add('free_postage');
  }
  if (parsed.new) {
    quick.add('new');
  }
  if (parsed.appraise) {
    quick.add('appraise');
  }

  const sort = resolveSortPreset(parsed.sort);
  const minPrice = parseNonNegativeNumber(parsed.minPrice, '--min-price');
  const maxPrice = parseNonNegativeNumber(parsed.maxPrice, '--max-price');
  const publishDays = parsePublishDays(parsed.publishDays);
  const latitude = parseOptionalCoordinate(parsed.lat, '--lat');
  const longitude = parseOptionalCoordinate(parsed.lng, '--lng');
  const distanceMeters = parseNonNegativeNumber(parsed.distance, '--distance');

  const filters = {
    ...(sort === 'default' ? {} : { sort }),
    ...(minPrice === undefined ? {} : { minPrice }),
    ...(maxPrice === undefined ? {} : { maxPrice }),
    ...(publishDays === undefined ? {} : { publishDays }),
    ...(quick.size === 0 ? {} : { quickFilters: [...quick] }),
    ...(parsed.province === undefined ? {} : { province: parsed.province.trim() }),
    ...(parsed.city === undefined ? {} : { city: parsed.city.trim() }),
    ...(parsed.area === undefined ? {} : { area: parsed.area.trim() }),
    ...(parsed.excludeMultiPlaces ? { excludeMultiPlacesSellers: true } : {}),
    ...(latitude === undefined ? {} : { latitude }),
    ...(longitude === undefined ? {} : { longitude }),
    ...(distanceMeters === undefined ? {} : { distanceMeters })
  };

  return Object.keys(filters).length === 0 ? undefined : filters;
}

function parseOptionalCoordinate(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new XianyuCommandError(
      'XIANYU_INVALID_INPUT',
      `${flag} must be a finite number.`,
      2,
      { [flag]: raw }
    );
  }
  return value;
}

export function handleXianyuCommandError(
  error: unknown,
  io: { stderr: (value: string) => void }
): number | undefined {
  if (!(error instanceof XianyuCommandError)) {
    return undefined;
  }
  io.stderr(`${renderXianyuCommandErrorAsJson(error)}\n`);
  return error.exitCode;
}
