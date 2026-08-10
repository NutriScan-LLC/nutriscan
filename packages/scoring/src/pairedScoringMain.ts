#!/usr/bin/env node
import {
  executeM35SubmissionWithNode,
  loadFixedM35OfflineArtifact,
} from './measurementSubmissionDiagnostic.js';
import { createPairedScoringArtifactWriter } from './pairedScoringDiagnostic.js';
import { runPairedScoringCli } from './pairedScoringCli.js';
import { executeFixedBioZoomPreRequestOnceWithNode } from './preRequestDiagnostic.js';

process.exitCode = await runPairedScoringCli(process.argv.slice(2), {
  loadSourceArtifact: loadFixedM35OfflineArtifact,
  executePreRequest: executeFixedBioZoomPreRequestOnceWithNode,
  executeMeasurement: executeM35SubmissionWithNode,
  writeArtifact: createPairedScoringArtifactWriter(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}, {
  stdout: (message) => process.stdout.write(`${message}\n`),
  stderr: (message) => process.stderr.write(`${message}\n`),
});
