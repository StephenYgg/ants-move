import { Command, CommanderError } from 'commander';
import { ZodError } from 'zod';

import {
  handleHackerNewsCommandError,
  registerHackerNewsCommands
} from './hn/command.js';
import {
  createDefaultHackerNewsRuntime,
  type HackerNewsRuntime
} from './hn/runtime.js';
import {
  handleKr36CommandError,
  registerKr36Commands
} from './36kr/command.js';
import {
  createDefaultKr36Runtime,
  type Kr36Runtime
} from './36kr/runtime.js';
import {
  handleToutiaoCommandError,
  registerToutiaoCommands
} from './toutiao/command.js';
import {
  createDefaultToutiaoRuntime,
  type ToutiaoRuntime
} from './toutiao/runtime.js';
import {
  handleGitHubCommandError,
  registerGitHubCommands
} from './github/command.js';
import { createDefaultGitHubRuntime } from './github/runtime.js';
import type { GitHubRuntime } from './github/types.js';

export interface CliIo {
  stderr: (value: string) => void;
  stdout: (value: string) => void;
}

export interface CliRunner {
  run: (args: string[]) => Promise<number>;
}

export interface CreateCliOptions extends Partial<CliIo> {
  githubRuntime?: GitHubRuntime;
  hackerNewsRuntime?: HackerNewsRuntime;
  kr36Runtime?: Kr36Runtime;
  toutiaoRuntime?: ToutiaoRuntime;
}

export function createCli(options: CreateCliOptions = {}): CliRunner {
  const io: CliIo = {
    stderr: options.stderr ?? ((value) => process.stderr.write(value)),
    stdout: options.stdout ?? ((value) => process.stdout.write(value))
  };
  const program = new Command()
    .name('ants')
    .description('Move data between systems with composable collectors.')
    .showHelpAfterError()
    .exitOverride();

  program.configureOutput({
    outputError: () => undefined,
    writeErr: () => undefined,
    writeOut: (value) => io.stdout(value)
  });

  registerKr36Commands(program, {
    runtime: options.kr36Runtime ?? createDefaultKr36Runtime(),
    stderr: io.stderr,
    stdout: io.stdout
  });
  registerHackerNewsCommands(program, {
    runtime: options.hackerNewsRuntime ?? createDefaultHackerNewsRuntime(),
    stderr: io.stderr,
    stdout: io.stdout
  });
  registerGitHubCommands(program, {
    runtime: options.githubRuntime ?? createDefaultGitHubRuntime(),
    stderr: io.stderr,
    stdout: io.stdout
  });
  registerToutiaoCommands(program, {
    runtime: options.toutiaoRuntime ?? createDefaultToutiaoRuntime(),
    stderr: io.stderr,
    stdout: io.stdout
  });

  return {
    run: async (args) => {
      try {
        await program.parseAsync(args, { from: 'user' });
        return 0;
      } catch (error) {
        if (error instanceof CommanderError && error.exitCode === 0) {
          return 0;
        }

        const githubExitCode = handleGitHubCommandError(error, io);
        if (githubExitCode !== undefined) {
          return githubExitCode;
        }

        const toutiaoExitCode = handleToutiaoCommandError(error, io);
        if (toutiaoExitCode !== undefined) {
          return toutiaoExitCode;
        }

        const hackerNewsExitCode = handleHackerNewsCommandError(error, io);
        if (hackerNewsExitCode !== undefined) {
          return hackerNewsExitCode;
        }

        const kr36ExitCode = handleKr36CommandError(error, io);
        if (kr36ExitCode !== undefined) {
          return kr36ExitCode;
        }

        if (error instanceof ZodError || error instanceof CommanderError) {
          const message = error instanceof ZodError
            ? error.issues[0]?.message ?? 'Invalid command arguments.'
            : error.message;
          writeCliError(io, 'INVALID_ARGUMENT', message);
          return 2;
        }

        writeCliError(
          io,
          'INTERNAL_ERROR',
          'An unexpected internal error occurred.'
        );
        return 1;
      }
    }
  };
}

function writeCliError(io: CliIo, code: string, message: string): void {
  io.stderr(`${JSON.stringify({
    ok: false,
    error: {
      code,
      message
    }
  }, null, 2)}\n`);
}
