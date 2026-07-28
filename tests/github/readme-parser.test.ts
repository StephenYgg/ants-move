import { describe, expect, it } from 'vitest';

import { parseGitHubReadmeResponse } from '../../src/github/readme-parser.js';

const OWNER = 'example';
const REPO = 'project';
const SOURCE_URL = 'https://api.github.com/repos/example/project/readme';

function responseBody(overrides: Record<string, unknown> = {}): Uint8Array {
  const content = Buffer.from('# Project\n', 'utf8');
  return new TextEncoder().encode(JSON.stringify({
    content: content.toString('base64'),
    download_url: 'https://raw.githubusercontent.com/example/project/main/README.md',
    encoding: 'base64',
    html_url: 'https://github.com/example/project/blob/main/README.md',
    name: 'README.md',
    path: 'README.md',
    sha: '0123456789abcdef0123456789abcdef01234567',
    size: content.byteLength,
    ...overrides
  }));
}

function parse(body = responseBody()) {
  return parseGitHubReadmeResponse(body, {
    owner: OWNER,
    repo: REPO,
    sourceUrl: SOURCE_URL
  });
}

describe('GitHub README response parser', () => {
  it('maps metadata and decodes raw UTF-8 content', () => {
    expect(parse()).toEqual({
      content: '# Project\n',
      downloadUrl: 'https://raw.githubusercontent.com/example/project/main/README.md',
      htmlUrl: 'https://github.com/example/project/blob/main/README.md',
      name: 'README.md',
      path: 'README.md',
      sha: '0123456789abcdef0123456789abcdef01234567',
      size: 10,
      sourceUrl: SOURCE_URL
    });
  });

  it('supports GitHub selecting a nested README with another extension', () => {
    const content = Buffer.from('Project\n=======\n', 'utf8');
    expect(parse(responseBody({
      content: content.toString('base64'),
      download_url: 'https://raw.githubusercontent.com/example/project/main/docs/README.rst',
      html_url: 'https://github.com/example/project/blob/main/docs/README.rst',
      name: 'README.rst',
      path: 'docs/README.rst',
      size: content.byteLength
    }))).toMatchObject({
      content: 'Project\n=======\n',
      name: 'README.rst',
      path: 'docs/README.rst'
    });
  });

  it.each([
    ['malformed JSON', new TextEncoder().encode('{')],
    ['invalid response UTF-8', new Uint8Array([0xff])],
    ['missing fields', new TextEncoder().encode('{}')]
  ])('rejects %s without exposing response data', (_label, body) => {
    const error = (() => {
      try {
        parse(body);
      } catch (failure) {
        return failure;
      }
      return undefined;
    })();

    expect(error).toMatchObject({
      code: 'GITHUB_PARSE_FAILED',
      details: { sourceUrl: SOURCE_URL }
    });
    expect(JSON.stringify(error)).not.toContain('content');
  });

  it.each([
    { content: 'not base64!', label: 'malformed Base64' },
    { encoding: 'utf-8', label: 'unsupported encoding' },
    { name: '', label: 'empty name' },
    { path: '', label: 'empty path' },
    { sha: '', label: 'empty SHA' },
    { size: -1, label: 'negative size' },
    { size: Number.MAX_SAFE_INTEGER + 1, label: 'unsafe size' },
    { size: 9, label: 'decoded-size mismatch' }
  ])('rejects $label', (overrides) => {
    expect(() => parse(responseBody(overrides))).toThrowError(
      expect.objectContaining({ code: 'GITHUB_PARSE_FAILED' })
    );
  });

  it('rejects invalid README content UTF-8', () => {
    expect(() => parse(responseBody({
      content: Buffer.from([0xff]).toString('base64'),
      size: 1
    }))).toThrowError(expect.objectContaining({
      code: 'GITHUB_PARSE_FAILED'
    }));
  });

  it.each([
    { html_url: 'http://[' },
    { html_url: 'http://github.com/example/project/blob/main/README.md' },
    { html_url: 'https://github.example/example/project/blob/main/README.md' },
    { html_url: 'https://github.com:444/example/project/blob/main/README.md' },
    { html_url: 'https://user:secret@github.com/example/project/blob/main/README.md' },
    { html_url: 'https://:secret@github.com/example/project/blob/main/README.md' },
    { html_url: 'https://github.com/example/project' },
    { html_url: 'https://github.com/other/project/blob/main/README.md' },
    { html_url: 'https://github.com/example/other/blob/main/README.md' },
    { html_url: 'https://github.com/example/project/tree/main/README.md' },
    { download_url: 'http://raw.githubusercontent.com/example/project/main/README.md' },
    { download_url: 'https://example.com/example/project/main/README.md' },
    { download_url: 'https://raw.githubusercontent.com/example/project' },
    { download_url: 'https://raw.githubusercontent.com/other/project/main/README.md' },
    { download_url: 'https://raw.githubusercontent.com/example/other/main/README.md' }
  ])('rejects unsafe or mismatched metadata URLs', (overrides) => {
    expect(() => parse(responseBody(overrides))).toThrowError(
      expect.objectContaining({ code: 'GITHUB_PARSE_FAILED' })
    );
  });
});
