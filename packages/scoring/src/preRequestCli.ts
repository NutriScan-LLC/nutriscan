import type { PreRequestDiagnosticDependencies } from './preRequestDiagnostic.js';
import { BIOZOOM_PRE_REQUEST_DIAGNOSTIC_URL, runBioZoomPreRequestDiagnostic } from './preRequestDiagnostic.js';

export interface PreRequestCliIo {
  stdout(message: string): void;
  stderr(message: string): void;
}

export async function runPreRequestCli(
  args: readonly string[],
  dependencies: PreRequestDiagnosticDependencies,
  io: PreRequestCliIo,
): Promise<number> {
  const unsupported = args.find((argument) => argument !== '--execute');
  if (unsupported !== undefined) {
    io.stderr(`Unsupported option: ${unsupported}. No network request was made.`);
    return 2;
  }
  if (args.filter((argument) => argument === '--execute').length > 1) {
    io.stderr('Duplicate --execute flag. No network request was made.');
    return 2;
  }
  if (!args.includes('--execute')) {
    io.stdout(`DRY RUN: would send exactly one GET diagnostic operation to ${BIOZOOM_PRE_REQUEST_DIAGNOSTIC_URL}, follow ordinary HTTP redirects, save the response, and stop. No network request was made. Add --execute to proceed.`);
    return 0;
  }

  io.stdout(`Experimental BioZoom pre-request-only diagnostic beginning: GET ${BIOZOOM_PRE_REQUEST_DIAGNOSTIC_URL}`);
  try {
    const { artifact, file } = await runBioZoomPreRequestDiagnostic(dependencies);
    io.stdout(JSON.stringify(artifact.observation, null, 2));
    io.stdout(`Diagnostic artifact: ${file}`);
    return 0;
  } catch (error) {
    const diagnosticArtifact = typeof error === 'object' && error !== null && 'diagnosticArtifact' in error
      ? String(error.diagnosticArtifact)
      : 'unknown';
    io.stderr(`${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\nDiagnostic artifact: ${diagnosticArtifact}`);
    return 1;
  }
}
