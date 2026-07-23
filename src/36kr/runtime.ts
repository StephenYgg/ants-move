import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  Kr36CommandError,
  type Kr36JsonRequest,
  type Kr36Request
} from './types.js';

export interface Kr36Runtime {
  fetchArticleHtml: (request: Kr36Request) => Promise<string>;
  fetchJson: (request: Kr36JsonRequest) => Promise<string>;
}

export type Kr36ExecFile = (
  file: string,
  args: string[],
  options: { encoding: 'utf8'; maxBuffer: number }
) => Promise<{ stderr: string; stdout: string }>;

const execFileAsync = promisify(nodeExecFile) as unknown as Kr36ExecFile;

export function createDefaultKr36Runtime(options: {
  execFile?: Kr36ExecFile;
} = {}): Kr36Runtime {
  const execFile = options.execFile ?? execFileAsync;

  return {
    fetchArticleHtml: async (request) => fetchWithCurl(execFile, request),
    fetchJson: async (request) => fetchWithCurl(execFile, request)
  };
}

async function fetchWithCurl(
  execFile: Kr36ExecFile,
  request: Kr36JsonRequest | Kr36Request
): Promise<string> {
  const args = [
    '--silent',
    '--show-error',
    '--location',
    '--compressed',
    '--connect-timeout',
    '10',
    '--max-time',
    '45',
    ...Object.entries(request.headers).flatMap(([name, value]) => [
      '--header',
      `${name}: ${value}`
    ]),
    ...('body' in request ? ['--data-raw', JSON.stringify(request.body)] : []),
    request.url
  ];

  try {
    const result = await execFile('curl', args, {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024
    });
    return result.stdout;
  } catch (error) {
    const execError = error as Error & { code?: number | string; stderr?: string };
    const failureReason = execError.stderr?.trim() || 'curl request failed.';
    throw new Kr36CommandError(
      'KR36_REQUEST_FAILED',
      `Failed to fetch 36kr page: ${failureReason}`,
      1,
      {
        curlExitCode: execError.code,
        url: request.url
      }
    );
  }
}
