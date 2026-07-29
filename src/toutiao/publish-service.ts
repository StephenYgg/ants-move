import { readFile, stat } from 'node:fs/promises';

import type { ToutiaoPublishRuntime } from './publish-runtime.js';
import {
  MAX_IMAGE_BYTES,
  MAX_MICRO_IMAGES,
  MAX_PUBLISH_CONTENT_BYTES
} from './publisher/form-map.js';
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
    category?: string;
    claim?: string;
    content?: string;
    contentFile?: string;
    cover?: string;
    dryRun?: boolean;
    headed?: boolean;
    keywords?: string[];
    statePath?: string;
    strategy?: ToutiaoPublishStrategy;
    title: string;
  }): Promise<ToutiaoPublishResult> {
    const strategy = input.strategy ?? 'draft';
    const dryRun = input.dryRun ?? false;
    const headed = input.headed ?? false;
    const statePath = resolveToutiaoStatePath(input.statePath);
    const content = await resolveContent({
      ...(input.content === undefined ? {} : { content: input.content }),
      ...(input.contentFile === undefined ? {} : { contentFile: input.contentFile })
    });
    const keywords = input.keywords ?? [];
    const title = input.title.trim();

    if (title === '') {
      throw invalidInput('Article title must not be empty.');
    }

    assertContentSize(content, 'article body');
    if (input.cover !== undefined) {
      await assertImageFile(input.cover, 'cover image');
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
        { statePath, headed },
        async (session) => session.publishArticle({
          content,
          keywords,
          strategy,
          title,
          ...(input.category === undefined ? {} : { category: input.category }),
          ...(input.claim === undefined ? {} : { claim: input.claim }),
          ...(input.cover === undefined ? {} : { coverPath: input.cover })
        })
      )
    );
  }

  async publishMicro(input: {
    content?: string;
    contentFile?: string;
    dryRun?: boolean;
    headed?: boolean;
    images?: string[];
    statePath?: string;
    strategy?: ToutiaoPublishStrategy;
    topic?: string;
  }): Promise<ToutiaoPublishResult> {
    const strategy = input.strategy ?? 'draft';
    const dryRun = input.dryRun ?? false;
    const headed = input.headed ?? false;
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
        { statePath, headed },
        async (session) => session.publishMicro({
          content,
          imagePaths,
          strategy,
          ...(input.topic === undefined ? {} : { topic: input.topic })
        })
      )
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
