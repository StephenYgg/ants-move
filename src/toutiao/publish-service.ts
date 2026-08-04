import { readFile, stat } from 'node:fs/promises';

import { resolveToutiaoBrowserChannel } from './browser-channel.js';
import type { ToutiaoPublishRuntime } from './publish-runtime.js';
import {
  MAX_ARTICLE_BODY_IMAGES,
  MAX_ARTICLE_TITLE_CHARS,
  MAX_IMAGE_BYTES,
  MAX_MICRO_IMAGES,
  MAX_PUBLISH_CONTENT_BYTES,
  MIN_ARTICLE_BODY_IMAGES,
  MIN_ARTICLE_TITLE_CHARS,
  MIN_MICRO_IMAGES
} from './publisher/form-map.js';
import {
  countContentChars,
  MIN_FIRST_PUBLISH_CONTENT_CHARS
} from './publisher/form-options.js';
import { resolveToutiaoStatePath, stateFileExists, withToutiaoStateLock } from './state.js';
import {
  ToutiaoCommandError,
  type ToutiaoPublishResult,
  type ToutiaoPublishStrategy
} from './types.js';

export interface ToutiaoPublishServiceDependencies {
  publishRuntime: ToutiaoPublishRuntime;
}

export class ToutiaoPublishService {
  constructor(private readonly dependencies: ToutiaoPublishServiceDependencies) {}

  async publishArticle(input: {
    browser?: string;
    category?: string;
    cdpUrl?: string;
    claim?: string;
    content?: string;
    contentFile?: string;
    cover?: string;
    covers?: string[];
    dryRun?: boolean;
    firstPublish?: boolean;
    headed?: boolean;
    /** Body images embedded in paragraphs (≥3 required). */
    images?: string[];
    keywords?: string[];
    /** Optional 添加位置; best-effort UI fill. */
    location?: string;
    statePath?: string;
    strategy?: ToutiaoPublishStrategy;
    title: string;
  }): Promise<ToutiaoPublishResult> {
    const strategy = input.strategy ?? 'draft';
    const dryRun = input.dryRun ?? false;
    const headed = input.headed ?? false;
    const firstPublish = input.firstPublish ?? false;
    const browser = resolveToutiaoBrowserChannel(input.browser);
    const statePath = resolveToutiaoStatePath(input.statePath);
    const content = await resolveContent({
      ...(input.content === undefined ? {} : { content: input.content }),
      ...(input.contentFile === undefined ? {} : { contentFile: input.contentFile })
    });
    const keywords = input.keywords ?? [];
    const title = input.title.trim();
    const coverPaths = input.covers ?? [];
    const bodyImagePaths = input.images ?? [];

    if (title === '') {
      throw invalidInput('Article title must not be empty.');
    }

    const titleChars = Array.from(title).length;
    if (titleChars < MIN_ARTICLE_TITLE_CHARS || titleChars > MAX_ARTICLE_TITLE_CHARS) {
      throw invalidInput(
        `Article title must be between ${MIN_ARTICLE_TITLE_CHARS} and ${MAX_ARTICLE_TITLE_CHARS} characters.`,
        {
          length: titleChars,
          max: MAX_ARTICLE_TITLE_CHARS,
          min: MIN_ARTICLE_TITLE_CHARS
        }
      );
    }

    assertContentSize(content, 'article body');
    if (firstPublish) {
      assertFirstPublishLength(content);
    }

    if (bodyImagePaths.length < MIN_ARTICLE_BODY_IMAGES) {
      throw invalidInput(
        `Article requires at least ${MIN_ARTICLE_BODY_IMAGES} body images embedded in paragraphs.`,
        { min: MIN_ARTICLE_BODY_IMAGES, provided: bodyImagePaths.length }
      );
    }
    if (bodyImagePaths.length > MAX_ARTICLE_BODY_IMAGES) {
      throw invalidInput(
        `Article supports at most ${MAX_ARTICLE_BODY_IMAGES} body images.`,
        { max: MAX_ARTICLE_BODY_IMAGES, provided: bodyImagePaths.length }
      );
    }
    for (const imagePath of bodyImagePaths) {
      await assertImageFile(imagePath, 'article body image');
    }

    if (input.cover !== undefined) {
      await assertImageFile(input.cover, 'cover image');
    }
    for (const coverPath of coverPaths) {
      await assertImageFile(coverPath, 'cover image');
    }
    if (coverPaths.length > 3) {
      throw invalidInput('Article supports at most 3 cover images (三图).', {
        max: 3,
        provided: coverPaths.length
      });
    }

    if (dryRun) {
      await assertAuthStatePresent(statePath);
      return {
        status: 'dry_run',
        strategy,
        title,
        type: 'article'
      };
    }

    return withToutiaoStateLock(statePath, async () =>
      this.dependencies.publishRuntime.withAuthedSession(
        {
          browser,
          statePath,
          headed,
          ...(input.cdpUrl === undefined ? {} : { cdpUrl: input.cdpUrl })
        },
        async (session) => session.publishArticle({
          bodyImagePaths,
          content,
          keywords,
          strategy,
          title,
          firstPublish,
          ...(input.category === undefined ? {} : { category: input.category }),
          ...(input.claim === undefined ? {} : { claim: input.claim }),
          ...(input.cover === undefined ? {} : { coverPath: input.cover }),
          ...(coverPaths.length === 0 ? {} : { coverPaths }),
          ...(input.location === undefined ? {} : { location: input.location })
        })
      )
    );
  }

  async publishMicro(input: {
    browser?: string;
    cdpUrl?: string;
    claim?: string;
    content?: string;
    contentFile?: string;
    dryRun?: boolean;
    firstPublish?: boolean;
    headed?: boolean;
    images?: string[];
    /** Optional 添加位置; best-effort UI fill. */
    location?: string;
    statePath?: string;
    strategy?: ToutiaoPublishStrategy;
    topic?: string;
  }): Promise<ToutiaoPublishResult> {
    const strategy = input.strategy ?? 'draft';
    const dryRun = input.dryRun ?? false;
    const headed = input.headed ?? false;
    const firstPublish = input.firstPublish ?? false;
    const browser = resolveToutiaoBrowserChannel(input.browser);
    const statePath = resolveToutiaoStatePath(input.statePath);
    const content = await resolveContent({
      ...(input.content === undefined ? {} : { content: input.content }),
      ...(input.contentFile === undefined ? {} : { contentFile: input.contentFile })
    });
    const imagePaths = input.images ?? [];

    if (content.trim() === '') {
      throw invalidInput('Micro-post content must not be empty.');
    }

    assertContentSize(content, 'micro-post body');
    if (firstPublish) {
      assertFirstPublishLength(content);
    }
    if (imagePaths.length < MIN_MICRO_IMAGES) {
      throw invalidInput(
        `Micro-post requires at least ${MIN_MICRO_IMAGES} images.`,
        { minImages: MIN_MICRO_IMAGES, provided: imagePaths.length }
      );
    }
    if (imagePaths.length > MAX_MICRO_IMAGES) {
      throw invalidInput(
        `Micro-post supports at most ${MAX_MICRO_IMAGES} images.`,
        { maxImages: MAX_MICRO_IMAGES, provided: imagePaths.length }
      );
    }

    for (const imagePath of imagePaths) {
      await assertImageFile(imagePath, 'micro-post image');
    }

    if (dryRun) {
      await assertAuthStatePresent(statePath);
      return {
        status: 'dry_run',
        strategy,
        type: 'micro'
      };
    }

    return withToutiaoStateLock(statePath, async () =>
      this.dependencies.publishRuntime.withAuthedSession(
        {
          browser,
          statePath,
          headed,
          ...(input.cdpUrl === undefined ? {} : { cdpUrl: input.cdpUrl })
        },
        async (session) => session.publishMicro({
          content,
          imagePaths,
          strategy,
          firstPublish,
          ...(input.claim === undefined ? {} : { claim: input.claim }),
          ...(input.location === undefined ? {} : { location: input.location }),
          ...(input.topic === undefined ? {} : { topic: input.topic })
        })
      )
    );
  }
}

function assertFirstPublishLength(content: string): void {
  const chars = countContentChars(content);
  if (chars < MIN_FIRST_PUBLISH_CONTENT_CHARS) {
    throw invalidInput(
      `头条首发 requires at least ${MIN_FIRST_PUBLISH_CONTENT_CHARS} content characters (got ${chars}).`,
      { min: MIN_FIRST_PUBLISH_CONTENT_CHARS, provided: chars }
    );
  }
}

async function resolveContent(options: {
  content?: string;
  contentFile?: string;
}): Promise<string> {
  const hasContent = options.content !== undefined;
  const hasFile = options.contentFile !== undefined;

  if (hasContent === hasFile) {
    throw invalidInput('Provide exactly one of --content or --content-file.');
  }

  if (options.content !== undefined) {
    return options.content;
  }

  try {
    return await readFile(options.contentFile as string, 'utf8');
  } catch {
    throw invalidInput('Content file could not be read.', {
      contentFile: options.contentFile
    });
  }
}

function assertContentSize(content: string, label: string): void {
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_PUBLISH_CONTENT_BYTES) {
    throw invalidInput(`${label} exceeds the ${MAX_PUBLISH_CONTENT_BYTES} byte limit.`, {
      bytes,
      maxBytes: MAX_PUBLISH_CONTENT_BYTES
    });
  }
}

async function assertImageFile(path: string, label: string): Promise<void> {
  try {
    const info = await stat(path);
    if (!info.isFile()) {
      throw invalidInput(`${label} path is not a file.`, { path });
    }
    if (info.size > MAX_IMAGE_BYTES) {
      throw invalidInput(`${label} exceeds the ${MAX_IMAGE_BYTES} byte limit.`, {
        maxBytes: MAX_IMAGE_BYTES,
        path,
        size: info.size
      });
    }
  } catch (error) {
    if (error instanceof ToutiaoCommandError) {
      throw error;
    }
    throw invalidInput(`${label} could not be read.`, { path });
  }
}

async function assertAuthStatePresent(statePath: string): Promise<void> {
  if (!(await stateFileExists(statePath))) {
    throw new ToutiaoCommandError(
      'TOUTIAO_AUTH_REQUIRED',
      'Toutiao auth state file is missing. Run `ants toutiao auth login` first.',
      2,
      { statePath }
    );
  }
}

function invalidInput(message: string, details?: unknown): ToutiaoCommandError {
  return new ToutiaoCommandError('TOUTIAO_INVALID_INPUT', message, 2, details);
}
