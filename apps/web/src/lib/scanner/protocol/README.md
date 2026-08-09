# Scanner protocol

Real WebUSB scanner protocol code (command construction, response parsing,
version detection, retries) goes here once hardware integration begins.
`WebUsbScannerService.ts` is the only file allowed to import from this
folder — nothing else in the app should need to.

Empty for now: no protocol logic has been written yet. Per the repo's
CLAUDE.md rules, never invent or modify scanner protocol behavior —
implement this only against confirmed real-hardware behavior.
