#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import {
  analyzeM7FlashResponse,
  analyzeM9FlashResponse,
  analyzeM10FlashResponse,
  analyzeM11FlashResponse,
  analyzeM12FlashResponse,
  analyzeM13FlashResponse,
  analyzeM14FlashResponse,
  BioZoomScanner,
} from '@nutriscan/scanner';
import { listNodeSerialPorts, NodeSerialTransport } from '@nutriscan/scanner/node';
import { buildOfflineBioZoomScoringProposal } from '@nutriscan/scoring';
import { runCli } from './app.js';
import { createFileTranscriptWriter } from './diagnostics.js';

const exitCode = await runCli(process.argv.slice(2), {
  // list() is metadata-only and is the sole path used by scanner:ports.
  listPorts: listNodeSerialPorts,
  createScanner(port, logger) {
    const transport = new NodeSerialTransport({
      path: port,
      baudRate: 2_000_000,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      logger,
    });
    return new BioZoomScanner(transport);
  },
  analyzeM7: analyzeM7FlashResponse,
  analyzeM9: analyzeM9FlashResponse,
  analyzeM10: analyzeM10FlashResponse,
  analyzeM11: analyzeM11FlashResponse,
  analyzeM12: analyzeM12FlashResponse,
  analyzeM13: analyzeM13FlashResponse,
  analyzeM14: analyzeM14FlashResponse,
  writeTranscript: createFileTranscriptWriter(),
  buildOfflineScoringProposal: buildOfflineBioZoomScoringProposal,
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  async waitForHandReady() {
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try {
      await terminal.question('Position hand on scanner. Press ENTER when hand is ready.');
    } finally {
      terminal.close();
    }
  },
  now: () => new Date(),
}, {
  stdout: (message) => process.stdout.write(`${message}\n`),
  stderr: (message) => process.stderr.write(`${message}\n`),
});

process.exitCode = exitCode;
