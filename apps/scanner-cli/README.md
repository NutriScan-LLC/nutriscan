# Experimental scanner CLI

This is an explicitly permissioned, experimental local diagnostic runner.
Port listing remains read-safe metadata enumeration.

No diagnostic action opens a port unless it has a named subcommand, an
explicit `--port` value, and `--execute`. Without `--execute`, the CLI prints
the exact planned workflow and exits without constructing a scanner.

```sh
npm run build --workspace apps/scanner-cli
npm run start --workspace apps/scanner-cli -- list
npm run start --workspace apps/scanner-cli -- list --json

# Dry runs (no open and no transmission)
npm run scanner:diag -- identify --port /dev/tty.usbmodem1101
npm run scanner:diag -- status --port /dev/tty.usbmodem1101
npm run scanner:diag -- experiment M7 --port /dev/tty.usbmodem1101
npm run scanner:diag -- experiment M9 --port /dev/tty.usbmodem1101
npm run scanner:diag -- experiment M10 --port /dev/tty.usbmodem1101
npm run scanner:diag -- experiment M11 --port /dev/tty.usbmodem1101
npm run scanner:diag -- experiment M12 --port /dev/tty.usbmodem1101
npm run scanner:diag -- experiment M15 --port /dev/tty.usbmodem1101
npm run scanner:diag -- offline-score --port /dev/tty.usbmodem1101 --lang EN

# Executed actions
npm run scanner:diag -- identify --port /dev/tty.usbmodem1101 --execute
npm run scanner:diag -- status --port /dev/tty.usbmodem1101 --execute
npm run scanner:diag -- experiment M7 --port /dev/tty.usbmodem1101 --execute
npm run scanner:diag -- experiment M9 --port /dev/tty.usbmodem1101 --execute
npm run scanner:diag -- experiment M10 --port /dev/tty.usbmodem1101 --execute
npm run scanner:diag -- experiment M11 --port /dev/tty.usbmodem1101 --execute
npm run scanner:diag -- experiment M12 --port /dev/tty.usbmodem1101 --execute
npm run scanner:diag -- experiment M15 --port /dev/tty.usbmodem1101 --execute
npm run scanner:diag -- offline-score --port /dev/tty.usbmodem1101 --lang EN --execute
```

Listing a port does not reserve it, communicate with it, or interfere with the
browser scanner test application. Executed actions create a JSON transcript in
`diagnostics/`, use the scanner package's Node transport and public scanner
abstraction, and always attempt to disconnect in a `finally` path.

Only the named M7 and M9–M15 experiments are supported. There is no
arbitrary-command mode. M7 is fixed to completed measurement 21, block 0,
range 3. M9 is fixed to measurement 21, block 150, range 150. M10 is fixed
to measurement 21, block 300, range 150.
M11 is fixed to measurement 21, block 450, range 150.
M12 is fixed to measurement 21, block 600, range 150.
M13 and M14 are fixed boundary reads for measurement 21 at blocks 5772 and
5773 respectively.

M15 is the only live-acquisition action. After explicit execution it connects,
identifies, and records baseline status before displaying
`Position hand on scanner. Press ENTER when hand is ready.` It waits indefinitely
for ENTER and only then sends one AOX measurement command. It progressively
retrieves and validates 5,773 logical blocks with bounded missing-range retries,
records final status, and stores the complete experimental artifact and
MeasurementBlocks SHA-256 in the diagnostic transcript. It never sends delete,
erase-chip, firmware, restart, or arbitrary commands.

`offline-score` is a separate end-to-end production-API diagnostic. It waits
for the same explicit hand-ready ENTER, calls `startAoxMeasurement()` exactly
once, then calls `downloadAoxMeasurement()` for the acknowledged measurement.
After all 5,773 blocks validate, it constructs an evidence-labelled scoring
proposal locally and saves the complete raw acquisition, exact
`MeasurementBlocks`, hash, proposed `measure_json`, endpoint template, and
multipart metadata in the transcript. The scoring package contains no HTTP
client and this action makes no pre-request or measurement request to BioZoom.
