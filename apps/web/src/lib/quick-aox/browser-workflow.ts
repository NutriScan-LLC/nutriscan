import { BioZoomScanner, WebSerialTransport } from "@nutriscan/scanner";
import { QuickAoxWorkflow } from "@nutriscan/workflows";
import { NutriScanBrowserScoringGateway } from "./browser-gateway";

export const BIOZOOM_WEB_SERIAL_BAUD_RATE = 2_000_000;

export function isWebSerialSupported(): boolean {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

export function createBrowserQuickAoxWorkflow(options?: {
  fetchImplementation?: typeof fetch;
}): QuickAoxWorkflow {
  const transport = new WebSerialTransport({
    baudRate: BIOZOOM_WEB_SERIAL_BAUD_RATE,
  });
  const scanner = new BioZoomScanner(transport);
  const scoring = new NutriScanBrowserScoringGateway(options?.fetchImplementation);
  return new QuickAoxWorkflow({ scanner, scoring });
}
