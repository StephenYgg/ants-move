import { z } from 'zod';

import {
  GitHubCommandError,
  type GitHubReadmeRuntimeResult
} from './types.js';

interface ParseGitHubReadmeResponseOptions {
  owner: string;
  repo: string;
  sourceUrl: string;
}

const responseSchema = z.object({
  content: z.string(),
  download_url: z.string().min(1),
  encoding: z.literal('base64'),
  html_url: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  sha: z.string().min(1),
  size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
});

const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function parseGitHubReadmeResponse(
  body: Uint8Array,
  options: ParseGitHubReadmeResponseOptions
): GitHubReadmeRuntimeResult {
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(body);
    const parsed = responseSchema.parse(JSON.parse(json));
    const normalizedContent = parsed.content.replace(/[\t\n\r ]/g, '');

    if (!BASE64.test(normalizedContent)) {
      throw new Error('Invalid Base64 content.');
    }

    const decoded = Buffer.from(normalizedContent, 'base64');
    if (decoded.byteLength !== parsed.size) {
      throw new Error('README size mismatch.');
    }

    return {
      content: new TextDecoder('utf-8', { fatal: true }).decode(decoded),
      downloadUrl: requireRepositoryUrl(
        parsed.download_url,
        'raw.githubusercontent.com',
        options,
        false
      ),
      htmlUrl: requireRepositoryUrl(
        parsed.html_url,
        'github.com',
        options,
        true
      ),
      name: parsed.name,
      path: parsed.path,
      sha: parsed.sha,
      size: parsed.size,
      sourceUrl: options.sourceUrl
    };
  } catch {
    throw new GitHubCommandError(
      'GITHUB_PARSE_FAILED',
      'Failed to parse GitHub README response.',
      2,
      { sourceUrl: options.sourceUrl }
    );
  }
}

function requireRepositoryUrl(
  value: string,
  hostname: 'github.com' | 'raw.githubusercontent.com',
  options: Pick<ParseGitHubReadmeResponseOptions, 'owner' | 'repo'>,
  requireBlobSegment: boolean
): string {
  const url = new URL(value);
  const segments = url.pathname.split('/').filter(Boolean);
  const expectedLength = requireBlobSegment ? 5 : 4;

  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== hostname ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    segments.length < expectedLength ||
    segments[0]?.toLowerCase() !== options.owner.toLowerCase() ||
    segments[1]?.toLowerCase() !== options.repo.toLowerCase() ||
    (requireBlobSegment && segments[2] !== 'blob')
  ) {
    throw new Error('Unexpected README URL.');
  }

  return url.toString();
}
