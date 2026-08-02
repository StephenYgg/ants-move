import { describe, expect, it } from 'vitest';

import {
  buildArticleBodySegments,
  countContentChars,
  MIN_FIRST_PUBLISH_CONTENT_CHARS
} from '../../src/toutiao/publisher/form-options.js';

describe('countContentChars', () => {
  it('counts CJK and strips whitespace', () => {
    expect(countContentChars('你好 世界')).toBe(4);
    expect(countContentChars('abc def')).toBe(6);
  });

  it('matches first-publish threshold helpers', () => {
    const short = '短文';
    expect(countContentChars(short)).toBeLessThan(MIN_FIRST_PUBLISH_CONTENT_CHARS);
    const long = '字'.repeat(MIN_FIRST_PUBLISH_CONTENT_CHARS);
    expect(countContentChars(long)).toBe(MIN_FIRST_PUBLISH_CONTENT_CHARS);
  });
});

describe('buildArticleBodySegments', () => {
  it('interleaves images between paragraphs and keeps leftovers at end', () => {
    const segments = buildArticleBodySegments(
      '第一段\n\n第二段\n\n第三段\n\n第四段',
      ['a.png', 'b.png', 'c.png']
    );
    expect(segments).toEqual([
      { type: 'text', value: '第一段' },
      { type: 'image', path: 'a.png' },
      { type: 'text', value: '第二段' },
      { type: 'image', path: 'b.png' },
      { type: 'text', value: '第三段' },
      { type: 'image', path: 'c.png' },
      { type: 'text', value: '第四段' }
    ]);
  });

  it('appends all images after a single paragraph', () => {
    const segments = buildArticleBodySegments('只有一段', ['1.png', '2.png', '3.png']);
    expect(segments).toEqual([
      { type: 'text', value: '只有一段' },
      { type: 'image', path: '1.png' },
      { type: 'image', path: '2.png' },
      { type: 'image', path: '3.png' }
    ]);
  });
});
