/** Completes the prior workflow/transport teardown before starting the selected workflow. */
export async function handoffScannerSession(releaseCurrent: () => Promise<void>, startSelected: () => void): Promise<void> {
  await releaseCurrent();
  startSelected();
}
