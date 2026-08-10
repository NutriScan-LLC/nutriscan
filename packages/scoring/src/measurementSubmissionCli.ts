import {
  BIOZOOM_M35_MEASURE_URL,
  FIXED_M35_OFFLINE_ARTIFACT_PATH,
  runM35MeasurementSubmissionDiagnostic,
  type MeasurementSubmissionDependencies,
} from './measurementSubmissionDiagnostic.js';

export interface MeasurementSubmissionCliIo {
  stdout(message: string): void;
  stderr(message: string): void;
}

export async function runMeasurementSubmissionCli(
  args: readonly string[],
  dependencies: MeasurementSubmissionDependencies,
  io: MeasurementSubmissionCliIo,
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
      `Would send exactly one POST to: ${BIOZOOM_M35_MEASURE_URL}`,
      'Multipart: one measure_json part; filename=measure.json; Content-Type=application/json.',
      'No scanner access, pre-request, retry, redirect follow, cookie, Authorization, credential, token, or additional metadata.',
      'Add --execute to perform the one submission.',
    ].join('\n'));
    return 0;
  }

  io.stdout(`Experimental measurement-35 single submission beginning: POST ${BIOZOOM_M35_MEASURE_URL}`);
  try {
    const { artifact, file } = await runM35MeasurementSubmissionDiagnostic(dependencies);
    io.stdout(JSON.stringify({
      request: artifact.request === null ? null : {
        ...artifact.request,
        measureJson: {
          ...artifact.request.measureJson,
          MeasurementBlocks: `<omitted from console; ${artifact.request.measurementBlocksLength} characters>`,
        },
      },
      observation: artifact.observation,
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
