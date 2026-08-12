import type { MediaListItem, MediaSourceDefinition } from './types.js';

const AI_KEYWORD_RE =
  /\b(AI|A\.I\.|artificial intelligence|OpenAI|Anthropic|DeepSeek|ChatGPT|LLM|machine learning|generative|Claude|Gemini|NVIDIA|neural|GPT-\d)\b/i;

function absoluteArticleUrl(baseOrigin: string, articleRef: string): string {
  const value = articleRef.trim();
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  const path = value.startsWith('/') ? value : `/${value}`;
  return new URL(path, baseOrigin).toString();
}

function storyUrl(baseOrigin: string, prefix: string, articleRef: string): string {
  const value = articleRef.trim();
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  const slug = value.replace(/^\/+|\/+$/g, '').replace(new RegExp(`^${prefix}/`), '');
  return `${baseOrigin}/${prefix}/${slug}/`.replace(/([^:]\/)\/+/g, '$1');
}

function filterAiItems(items: MediaListItem[]): MediaListItem[] {
  return items.filter(
    (item) =>
      AI_KEYWORD_RE.test(item.title) ||
      AI_KEYWORD_RE.test(item.summary ?? '') ||
      (item.keywords ?? []).some((keyword) => AI_KEYWORD_RE.test(keyword)) ||
      (item.categories ?? []).some((category) => AI_KEYWORD_RE.test(category))
  );
}

export const MEDIA_SOURCES: MediaSourceDefinition[] = [
  {
    buildArticleUrl: (ref) => storyUrl('https://www.wired.com', 'story', ref),
    channels: {
      AI: 'https://www.wired.com/feed/category/artificial-intelligence/rss',
      technology: 'https://www.wired.com/feed/category/gear/latest/rss',
      business: 'https://www.wired.com/feed/category/business/latest/rss',
      science: 'https://www.wired.com/feed/category/science/latest/rss',
      security: 'https://www.wired.com/feed/category/security/latest/rss',
      all: 'https://www.wired.com/feed/rss'
    },
    command: 'wired',
    description: 'Fetch WIRED technology and AI content.',
    source: 'wired'
  },
  {
    buildArticleUrl: (ref) => absoluteArticleUrl('https://www.technologyreview.com', ref),
    channels: {
      AI: 'https://www.technologyreview.com/topic/artificial-intelligence/feed',
      technology: 'https://www.technologyreview.com/feed/'
    },
    command: 'mtr',
    description: 'Fetch MIT Technology Review content.',
    source: 'mtr'
  },
  {
    buildArticleUrl: (ref) => absoluteArticleUrl('https://techcrunch.com', ref),
    channels: {
      AI: 'https://techcrunch.com/category/artificial-intelligence/feed/',
      technology: 'https://techcrunch.com/feed/'
    },
    command: 'techcrunch',
    description: 'Fetch TechCrunch technology and AI content.',
    source: 'techcrunch'
  },
  {
    buildArticleUrl: (ref) => absoluteArticleUrl('https://www.theverge.com', ref),
    channels: {
      AI: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
      technology: 'https://www.theverge.com/rss/index.xml'
    },
    command: 'verge',
    description: 'Fetch The Verge technology and AI content.',
    source: 'verge'
  },
  {
    buildArticleUrl: (ref) => absoluteArticleUrl('https://arstechnica.com', ref),
    channels: {
      AI: 'https://feeds.arstechnica.com/arstechnica/technology-lab',
      technology: 'https://feeds.arstechnica.com/arstechnica/index'
    },
    command: 'ars',
    description: 'Fetch Ars Technica technology content.',
    source: 'ars'
  },
  {
    buildArticleUrl: (ref) => absoluteArticleUrl('https://www.engadget.com', ref),
    channels: {
      technology: 'https://www.engadget.com/rss.xml',
      AI: 'https://www.engadget.com/rss.xml'
    },
    command: 'engadget',
    description: 'Fetch Engadget technology content.',
    filterListItems: (items, channel) =>
      channel === 'AI' ? filterAiItems(items) : items,
    source: 'engadget'
  },
  {
    buildArticleUrl: (ref) => absoluteArticleUrl('https://spectrum.ieee.org', ref),
    channels: {
      technology: 'https://spectrum.ieee.org/feeds/feed.rss',
      AI: 'https://spectrum.ieee.org/feeds/feed.rss'
    },
    command: 'ieee',
    description: 'Fetch IEEE Spectrum technology content.',
    filterListItems: (items, channel) =>
      channel === 'AI' ? filterAiItems(items) : items,
    source: 'ieee'
  },
  {
    buildArticleUrl: (ref) => absoluteArticleUrl('https://www.bbc.com', ref),
    channels: {
      technology: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
      AI: 'https://feeds.bbci.co.uk/news/technology/rss.xml'
    },
    command: 'bbc',
    description: 'Fetch BBC Technology content.',
    filterListItems: (items, channel) =>
      channel === 'AI' ? filterAiItems(items) : items,
    source: 'bbc'
  },
  {
    buildArticleUrl: (ref) => absoluteArticleUrl('https://blog.google', ref),
    channels: {
      AI: 'https://blog.google/technology/ai/rss/',
      technology: 'https://blog.google/technology/ai/rss/'
    },
    command: 'google-ai',
    description: 'Fetch Google AI Blog content.',
    source: 'google-ai'
  },
  {
    buildArticleUrl: (ref) => absoluteArticleUrl('https://deepmind.google', ref),
    channels: {
      AI: 'https://deepmind.google/blog/rss.xml',
      technology: 'https://deepmind.google/blog/rss.xml'
    },
    command: 'deepmind',
    description: 'Fetch Google DeepMind Blog content.',
    source: 'deepmind'
  },
  {
    buildArticleUrl: (ref) => absoluteArticleUrl('https://blogs.nvidia.com', ref),
    channels: {
      AI: 'https://blogs.nvidia.com/feed/',
      technology: 'https://blogs.nvidia.com/feed/'
    },
    command: 'nvidia',
    description: 'Fetch NVIDIA Blog content.',
    source: 'nvidia'
  },
  {
    buildArticleUrl: (ref) => absoluteArticleUrl('https://openai.com', ref),
    channels: {
      AI: 'https://openai.com/blog/rss.xml',
      technology: 'https://openai.com/blog/rss.xml'
    },
    command: 'openai',
    description: 'Fetch OpenAI Blog content.',
    source: 'openai'
  },
  {
    buildArticleUrl: (ref) => absoluteArticleUrl('https://www.bloomberg.com', ref),
    channels: {
      technology: 'https://feeds.bloomberg.com/technology/news.rss',
      AI: 'https://feeds.bloomberg.com/technology/news.rss'
    },
    command: 'bloomberg',
    description: 'Fetch Bloomberg Technology headlines (list only).',
    filterListItems: (items, channel) =>
      channel === 'AI' ? filterAiItems(items) : items,
    listOnly: true,
    source: 'bloomberg'
  }
];

export function getMediaSourceByCommand(
  command: string
): MediaSourceDefinition | undefined {
  return MEDIA_SOURCES.find((source) => source.command === command);
}
