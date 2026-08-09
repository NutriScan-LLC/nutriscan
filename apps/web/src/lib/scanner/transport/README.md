# Scanner transport

Raw WebUSB byte-level transport (open/close the device, read/write bytes —
no JSON parsing, no command knowledge) goes here once hardware integration
begins. `WebUsbScannerService.ts` is the only file allowed to import from
this folder — nothing else in the app should need to.

Empty for now: no transport code has been written yet.
