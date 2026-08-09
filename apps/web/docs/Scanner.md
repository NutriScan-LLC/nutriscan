# Scanner

## Supported Browsers

Chrome

Edge

Android Chrome

Unsupported

Safari

Firefox

iOS

---

# Connection Flow

Browser Check

↓

USB Check

↓

Permission Request

↓

Connect

↓

Scanner Ready

↓

Calibration

↓

Measurement

↓

Processing

↓

Results

---

# Scan Types

Quick Scan

30 seconds

Precision Scan

90 seconds

---

# User Instructions

Remove jewelry.

Dry hands.

No lotion.

Place palm flat.

Remain still.

Maintain light pressure.

Do not lift hand.

---

# Scanner States

Disconnected

Connecting

Ready

Scanning

Processing

Complete

Error

---

# Error Handling

USB disconnected

Permission denied

Unsupported browser

Scanner timeout

Calibration failed

Unexpected protocol response

---

# Protocol

Never modify protocol behavior without verification.

All protocol logic belongs in the SDK.

The UI never communicates directly with USB.

Only the scanner service layer talks to hardware.

---

# Known Limitations

Requires Chrome.

Requires WebUSB.

No iOS support.

Scanner must remain connected during scan.