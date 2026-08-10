#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { compareScoringContracts, type ScoringContractSnapshot } from './compare.js';

const args = process.argv.slice(2);
const officialPath = valueAfter(args, '--official');
const reconstructedPath = valueAfter(args, '--reconstructed');
if (officialPath === undefined || reconstructedPath === undefined || args.length !== 4) {
  process.stderr.write('Usage: scoring-contract --official <snapshot.json> --reconstructed <snapshot.json>\n');
  process.exitCode = 2;
} else {
  const official = JSON.parse(await readFile(officialPath, 'utf8')) as ScoringContractSnapshot;
  const reconstructed = JSON.parse(await readFile(reconstructedPath, 'utf8')) as ScoringContractSnapshot;
  const comparison = compareScoringContracts(official, reconstructed);
  process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`);
  process.exitCode = comparison.matches ? 0 : 1;
}

function valueAfter(args: readonly string[], option: string): string | undefined {
  const index = args.indexOf(option);
  return index < 0 ? undefined : args[index + 1];
}
