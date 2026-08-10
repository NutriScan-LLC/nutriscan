import {
  BIOZOOM_M35_MEASURE_URL,
  FIXED_M35_OFFLINE_ARTIFACT_PATH,
} from './measurementSubmissionDiagnostic.js';
import { BIOZOOM_PRE_REQUEST_DIAGNOSTIC_URL } from './preRequestDiagnostic.js';
import { runPairedScoringDiagnostic, type PairedScoringDependencies } from './pairedScoringDiagnostic.js';

export interface PairedScoringCliIo {
  stdout(message: string): void;
  stderr(message: string): void;
}

export async function runPairedScoringCli(
  args: readonly string[],
  dependencies: PairedScoringDependencies,
  io: PairedScoringCliIo,
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
    io.stdout([
      'DRY RUN: no network request was made.',
      `Source artifact: ${FIXED_M35_OFFLINE_ARTIFACT_PATH}`,
      `Would GET once: ${BIOZOOM_PRE_REQUEST_DIAGNOSTIC_URL}`,
      'Would require HTTP success, parse recommended_server and waiting_time_ms, and wait at least that duration.',
      `Expected runtime-confirmed POST target: ${BIOZOOM_M35_MEASURE_URL}`,
      'Would POST the unchanged measurement-35 measure_json once, without retries or redirect following.',
      'No scanner access, new measurement, cookie, Authorization, credential, token, API key, or invented header.',
      'Add --execute to perform the paired diagnostic.',
    ].join('\n'));
    return 0;
  }

  io.stdout(`Experimental paired scoring diagnostic beginning with GET ${BIOZOOM_PRE_REQUEST_DIAGNOSTIC_URL}`);
  try {
    const { artifact, file } = await runPairedScoringDiagnostic(dependencies);
    io.stdout(JSON.stringify({
      preRequest: artifact.preRequest,
      timing: artifact.timing,
      measurementRequest: artifact.measurementRequest === null ? null : {
        ...artifact.measurementRequest,
        measureJson: {
          ...artifact.measurementRequest.measureJson,
          MeasurementBlocks: `<omitted from console; ${artifact.measurementRequest.measurementBlocksLength} characters>`,
        },
      },
      measurementResponse: artifact.measurementResponse,
      startedAt: artifact.startedAt,
      completedAt: artifact.completedAt,
    }, null, 2));
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
