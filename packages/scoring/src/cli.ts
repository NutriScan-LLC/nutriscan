#!/usr/bin/env node
import { createPreRequestArtifactWriter, executeFixedBioZoomPreRequestWithNode } from './preRequestDiagnostic.js';
import { runPreRequestCli } from './preRequestCli.js';

process.exitCode = await runPreRequestCli(process.argv.slice(2), {
  executeHttp: executeFixedBioZoomPreRequestWithNode,
  writeArtifact: createPreRequestArtifactWriter(),
}, {
  stdout: (message) => process.stdout.write(`${message}\n`),
  stderr: (message) => process.stderr.write(`${message}\n`),
});
