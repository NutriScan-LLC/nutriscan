#!/usr/bin/env node
import {
  createMeasurementSubmissionArtifactWriter,
  executeM35SubmissionWithNode,
  loadFixedM35OfflineArtifact,
} from './measurementSubmissionDiagnostic.js';
import { runMeasurementSubmissionCli } from './measurementSubmissionCli.js';

process.exitCode = await runMeasurementSubmissionCli(process.argv.slice(2), {
  loadSourceArtifact: loadFixedM35OfflineArtifact,
  executeHttp: executeM35SubmissionWithNode,
  writeArtifact: createMeasurementSubmissionArtifactWriter(),
}, {
  stdout: (message) => process.stdout.write(`${message}\n`),
  stderr: (message) => process.stderr.write(`${message}\n`),
});
