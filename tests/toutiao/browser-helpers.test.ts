import { describe, expect, it } from 'vitest';

import { textToEditorHtml } from '../../src/toutiao/publisher/browser-helpers.js';

describe('textToEditorHtml', () => {
  it('escapes HTML and converts paragraphs', () => {
    expect(textToEditorHtml('a <b> & c\n\nsecond')).toBe(
      '<p>a &lt;b&gt; &amp; c</p><p>second</p>'
    );
  });
});
