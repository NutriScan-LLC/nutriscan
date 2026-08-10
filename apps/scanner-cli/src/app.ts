import type { DiagnosticAction, DiagnosticDependencies, DiagnosticRequest } from './diagnostics.js';
import { executeDiagnostic } from './diagnostics.js';
import type { ListPorts } from './ports.js';
import { listSerialPorts } from './ports.js';

export interface CliIo {
  stdout(message: string): void;
  stderr(message: string): void;
}

export interface CliDependencies extends DiagnosticDependencies {
  listPorts: ListPorts;
}

const HELP = `NutriScan experimental serial diagnostics

Usage:
  nutriscan-scanner list [--json]
  nutriscan-scanner identify --port <path> [--execute]
  nutriscan-scanner status --port <path> [--execute]
  nutriscan-scanner experiment M7 --port <path> [--execute]
  nutriscan-scanner experiment M9 --port <path> [--execute]
  nutriscan-scanner experiment M10 --port <path> [--execute]
  nutriscan-scanner experiment M11 --port <path> [--execute]
  nutriscan-scanner experiment M12 --port <path> [--execute]
  nutriscan-scanner experiment M13 --port <path> [--execute]
  nutriscan-scanner experiment M14 --port <path> [--execute]
  nutriscan-scanner experiment M15 --port <path> [--execute]
  nutriscan-scanner download M21 --port <path> [--execute]
  nutriscan-scanner offline-score --port <path> --lang <two-letter-code> [--execute]
  nutriscan-scanner help

Safety:
  list never opens a port or transmits.
  Diagnostic actions are dry-runs unless --execute is present.
  No action discovers or automatically selects a device.`;

export async function runCli(args: readonly string[], dependencies: CliDependencies, io: CliIo): Promise<number> {
  const [command, ...options] = args;

  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    io.stdout(HELP);
    return 0;
  }

  if (command === 'list') return runList(options, dependencies.listPorts, io);

  let parsed: { request: DiagnosticRequest; execute: boolean };
  try {
    parsed = parseDiagnostic(command, options);
  } catch (err) {
    io.stderr(err instanceof Error ? err.message : String(err));
    return 2;
  }

  if (!parsed.execute) {
    io.stdout(dryRunDescription(parsed.request));
    return 0;
  }

  try {
    await executeDiagnostic(parsed.request, dependencies, { log: io.stdout });
    return 0;
  } catch (err) {
    io.stderr(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    return 1;
  }
}

async function runList(options: readonly string[], listPorts: ListPorts, io: CliIo): Promise<number> {
  const invalidOption = options.find((option) => option !== '--json');
  if (invalidOption !== undefined) {
    io.stderr(`Unsupported option for list: ${invalidOption}`);
    return 2;
  }
  const ports = await listSerialPorts(listPorts);
  if (options.includes('--json')) {
    io.stdout(JSON.stringify(ports, null, 2));
  } else if (ports.length === 0) {
    io.stdout('No serial ports found. No port was opened.');
  } else {
    io.stdout([
      `Found ${ports.length} serial port(s). No port was opened:`,
      ...ports.map((port) => {
        const ids = port.vendorId === null && port.productId === null
          ? ''
          : ` (vendor=${port.vendorId ?? 'unknown'}, product=${port.productId ?? 'unknown'})`;
        return `- ${port.path}${ids}`;
      }),
    ].join('\n'));
  }
  return 0;
}

function parseDiagnostic(command: string, options: readonly string[]): { request: DiagnosticRequest; execute: boolean } {
  let action: DiagnosticAction;
  let remaining = options;
  if (command === 'identify' || command === 'status') {
    action = command;
  } else if (command === 'experiment') {
    const [experiment, ...rest] = options;
    if (!['M7', 'M9', 'M10', 'M11', 'M12', 'M13', 'M14', 'M15'].includes(experiment ?? '')) {
      throw new Error('Only explicitly named experiments M7 and M9–M15 are supported. No port was opened.');
    }
    action = experiment as DiagnosticAction;
    remaining = rest;
  } else if (command === 'download') {
    const [measurement, ...rest] = options;
    if (measurement !== 'M21') throw new Error('Only explicitly named download M21 is supported. No port was opened.');
    action = 'DOWNLOAD21';
    remaining = rest;
  } else if (command === 'offline-score') {
    action = 'OFFLINE-SCORING';
  } else {
    throw new Error(`Unsupported diagnostic action: ${command}. No port was opened.`);
  }

  let port: string | undefined;
  let execute = false;
  let language: string | undefined;
  for (let index = 0; index < remaining.length; index++) {
    const option = remaining[index]!;
    if (option === '--execute') {
      if (execute) throw new Error('Duplicate --execute flag. No port was opened.');
      execute = true;
    } else if (option === '--port') {
      if (port !== undefined) throw new Error('Duplicate --port option. No port was opened.');
      port = remaining[++index];
      if (port === undefined || port.length === 0 || port.startsWith('--')) {
        throw new Error('--port requires an explicit serial port path. No port was opened.');
      }
    } else if (option === '--lang') {
      if (language !== undefined) throw new Error('Duplicate --lang option. No port was opened.');
      language = remaining[++index];
      if (language === undefined || !/^[A-Za-z]{2}$/.test(language)) {
        throw new Error('--lang requires an explicit two-letter language value. No port was opened.');
      }
    } else {
      throw new Error(`Unsupported option: ${option}. No port was opened.`);
    }
  }
  if (port === undefined) throw new Error('--port is required for diagnostics. No port was opened.');
  if (action === 'OFFLINE-SCORING' && language === undefined) {
    throw new Error('--lang is required for offline-score. No port was opened.');
  }
  if (action !== 'OFFLINE-SCORING' && language !== undefined) {
    throw new Error('--lang is supported only for offline-score. No port was opened.');
  }
  return { request: { action, port, ...(language === undefined ? {} : { language }) }, execute };
}

function dryRunDescription(request: DiagnosticRequest): string {
  const operation = request.action === 'identify'
    ? 'connect, run BioZoomScanner.identify(), print the result and raw transcript, then disconnect'
    : request.action === 'status'
      ? 'connect, identify, send exactly one status request, print the response and raw transcript, then disconnect'
      : request.action === 'M7'
        ? 'connect, identify, send exactly one M7 read-flash request (nr=21, block=0, range=3), analyze it, then disconnect'
        : request.action === 'M9'
          ? 'connect, identify, send exactly one M9 read-flash request (nr=21, block=150, range=150), analyze it, then disconnect'
          : request.action === 'M10'
            ? 'connect, identify, send exactly one M10 read-flash request (nr=21, block=300, range=150), analyze it, then disconnect'
            : request.action === 'M11'
              ? 'connect, identify, send exactly one M11 read-flash request (nr=21, block=450, range=150), analyze it, then disconnect'
              : request.action === 'M12'
                ? 'connect, identify, send exactly one M12 read-flash request (nr=21, block=600, range=150), analyze it, then disconnect'
                : request.action === 'M13'
                  ? 'connect, identify, send exactly one M13 read-flash request (nr=21, block=5772, range=1), analyze it, then disconnect'
                  : request.action === 'M14'
                    ? 'connect, identify, send exactly one M14 read-flash request (nr=21, block=5773, range=1), analyze it, then disconnect'
                    : request.action === 'M15'
                      ? 'connect, identify, record baseline status, wait for explicit ENTER, send exactly one measure request (type=aox), progressively acquire and validate 5,773 logical blocks with bounded retries, record final status and SHA-256, then disconnect'
                    : request.action === 'DOWNLOAD21'
                      ? 'connect, identify, download measurement 21 using bounded range=150 read-flash requests and retry only missing ranges, then disconnect'
                      : `connect, identify, wait for explicit ENTER, start exactly one AOX measurement through the production scanner API, download and validate all 5,773 blocks, construct and save an offline-only BioZoom-compatible scoring proposal with lang=${request.language}, then disconnect; no HTTP request will be made`;
  return `DRY RUN: would ${operation} on explicit port ${request.port}. No port was opened and no bytes were sent. Add --execute to proceed.`;
}
