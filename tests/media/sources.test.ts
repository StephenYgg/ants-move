import { describe, expect, it } from 'vitest';

import { MEDIA_SOURCES } from '../../src/media/sources.js';
import type { MediaListItem } from '../../src/media/types.js';

const sampleItems: MediaListItem[] = [
  {
    id: '1',
    title: 'OpenAI launches model',
    url: 'https://example.com/1',
    summary: 'About artificial intelligence'
  },
  {
    id: '2',
    title: 'Phone battery tips',
    url: 'https://example.com/2',
    summary: 'Consumer gadget advice'
  }
];

describe('MEDIA_SOURCES', () => {
  it('registers unique commands and valid channel feeds', () => {
    const commands = MEDIA_SOURCES.map((source) => source.command);
    expect(new Set(commands).size).toBe(commands.length);

    for (const source of MEDIA_SOURCES) {
      expect(Object.keys(source.channels).length).toBeGreaterThan(0);
      for (const feedUrl of Object.values(source.channels)) {
        expect(feedUrl.startsWith('https://')).toBe(true);
      }
    }
  });

  it('builds absolute and slug article urls for every source', () => {
    for (const source of MEDIA_SOURCES) {
      const absolute = source.buildArticleUrl('https://example.com/path/to/story');
      expect(absolute).toBe('https://example.com/path/to/story');

      const relative = source.buildArticleUrl('sample-slug');
      expect(relative.startsWith('https://')).toBe(true);
      expect(relative).toContain('sample-slug');
    }

    const wired = MEDIA_SOURCES.find((source) => source.command === 'wired')!;
    expect(wired.buildArticleUrl('/story/hello-world')).toContain('/story/hello-world');
    expect(wired.buildArticleUrl('story/hello-world')).toContain('/story/hello-world');
  });

  it('applies AI keyword filters where configured', () => {
    for (const source of MEDIA_SOURCES) {
      if (!source.filterListItems) {
        continue;
      }
      const filtered = source.filterListItems(sampleItems, 'AI');
      expect(filtered.map((item) => item.id)).toEqual(['1']);
      const unfiltered = source.filterListItems(sampleItems, 'technology');
      expect(unfiltered).toHaveLength(2);
    }

    const bloomberg = MEDIA_SOURCES.find((source) => source.command === 'bloomberg')!;
    const byCategory = bloomberg.filterListItems?.(
      [
        {
          id: 'c1',
          title: 'Plain title',
          url: 'https://example.com/c1',
          categories: ['Artificial Intelligence']
        },
        {
          id: 'c2',
          title: 'Plain title',
          url: 'https://example.com/c2',
          keywords: ['LLM research']
        }
      ],
      'AI'
    );
    expect(byCategory?.map((item) => item.id)).toEqual(['c1', 'c2']);
  });

  it('marks bloomberg as list-only and resolves leading-slash refs', () => {
    const bloomberg = MEDIA_SOURCES.find((source) => source.command === 'bloomberg');
    expect(bloomberg?.listOnly).toBe(true);
    expect(bloomberg?.buildArticleUrl('/news/articles/x')).toBe(
      'https://www.bloomberg.com/news/articles/x'
    );
  });
});
