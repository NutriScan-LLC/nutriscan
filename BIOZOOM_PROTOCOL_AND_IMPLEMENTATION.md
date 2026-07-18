# BioZoom Scanner Reverse Engineering & SDK Specification

**Project:** NutriScan\
**Status:** Active Reverse Engineering / SDK Development\
**Primary Goal:** Build an open JavaScript/TypeScript SDK capable of
communicating with BioZoom VitalityCheck scanners without using the
Android application.

------------------------------------------------------------------------

# Project Overview

This project aims to completely reverse engineer the BioZoom
VitalityCheck scanner protocol and build a production-quality SDK that
can be integrated into NutriScan.

The SDK should support:

-   Browser (Web Serial)
-   Electron
-   Node.js
-   Future native wrappers

The scanner must be usable without the original Android software.

------------------------------------------------------------------------

# Guiding Principles

## Correctness first

Never guess.

If behavior is unknown:

-   Log it.
-   Test it.
-   Document it.

The protocol specification is the source of truth.

## Separate protocol from UI

Architecture:

``` text
UI
 ↓
SDK
 ↓
Protocol
 ↓
Transport
 ↓
Serial Port
```

Never mix scanner logic with HTML.

## Every discovery becomes documentation

Whenever behavior is confirmed, update:

`docs/protocol.md`

before continuing.

------------------------------------------------------------------------

# Recommended Repository Structure

``` text
packages/
  biozoom-sdk/
    src/
      transport/
      protocol/
      parser/
      crc/
      scanner/

apps/
  scanner-test/

docs/
  protocol.md

tests/
```

------------------------------------------------------------------------

# Architecture

``` text
Browser
 ↓
Web Serial
 ↓
SerialTransport
 ↓
Protocol V1 / Protocol V2
 ↓
BioZoomScanner
 ↓
NutriScan
```

------------------------------------------------------------------------

# Transport Layer

Responsible only for:

-   connect
-   disconnect
-   read
-   write
-   buffering
-   timeouts

No protocol knowledge.

# Protocol Layer

Responsible for:

-   Version detection
-   V1 commands
-   V2 commands
-   JSON parsing
-   call-index handling
-   retries
-   response validation

# Scanner Layer

Public API:

``` ts
await scanner.connect();
await scanner.getStatus();
await scanner.measureAOX();
await scanner.downloadMeasurement();
await scanner.disconnect();
```

No UI should send raw serial commands directly.

------------------------------------------------------------------------

# Confirmed Discoveries

## Serial Configuration

-   2,000,000 baud
-   8N1

## Scanner Families

Legacy

-   Serial prefix: `5W`
-   Protocol V1

Modern

-   Serial prefix: `2N`
-   Protocol V2

Confirmed device:

`2N2400A5B70F5E3C9251`

------------------------------------------------------------------------

# Protocol Detection

1.  Send `get_status`
2.  If JSON contains `"command"` → Version 2
3.  If response is an error, retry using `status`

Legacy scanners use `I` and `W`.

------------------------------------------------------------------------

# JSON Parsing

Some firmware prefixes JSON with one or more `0x80` bytes.

Strip all leading `0x80` bytes before parsing.

------------------------------------------------------------------------

# call-index Handling

Commands append:

    ?call-index=<random>

Responses may either:

-   return `"call-index"` directly, or
-   embed it inside `"command"`.

The parser must support both.

------------------------------------------------------------------------

# AOX Measurement

Command:

    measure?type=aox

Response returns:

-   measurement number
-   measurement type

------------------------------------------------------------------------

# Flash Download

Command:

    read-flash?nr=<measurement>&block=<start>&range=<count>

Returns an array of Base64 blocks.

------------------------------------------------------------------------

# Block Format

Each Base64 block decodes to **33 bytes**.

Layout:

-   Bytes 0--1: Length (big endian)
-   Bytes 2--3: Internal block index (little endian)
-   Remaining bytes: Payload + CRC

## Length

Declared length equals:

    decoded_length - 2

## CRC

Confirmed:

-   CRC16-CCITT
-   Polynomial: `0x1021`
-   Initial value: `0xFFFF`
-   Calculated over bytes 2 through end
-   Valid CRC result = `0x0000`

------------------------------------------------------------------------

# Confirmed Firmware Quirk

The first returned block reports internal index **1**.

The second block also reports internal index **1**.

Current normalization:

-   First physical block → logical index 0
-   All subsequent blocks remain unchanged

Document this behavior until verified on additional firmware versions.

------------------------------------------------------------------------

# Download Strategy

-   Request 150 blocks at a time.
-   Validate length.
-   Validate CRC.
-   Store:
    -   Base64
    -   Decoded bytes
    -   Logical index
    -   Internal index
-   Retry missing ranges up to 3 times.

------------------------------------------------------------------------

# Output Files

Generate:

-   `measurement.base64`
-   `measurement.json`

Manifest should include:

-   Scanner serial
-   Measurement number
-   Download timestamp
-   Block metadata
-   CRC status
-   Missing blocks

------------------------------------------------------------------------

# Testing Strategy

Every protocol change must be validated on real hardware.

Whenever possible:

Android output

↓

SDK output

↓

Byte-for-byte comparison

------------------------------------------------------------------------

# Immediate Roadmap

## Phase 1

Build SDK:

-   Transport
-   Protocol
-   Scanner

## Phase 2

Reliable measurement download:

-   CRC
-   Retry logic
-   Block ordering

## Phase 3

Reverse engineer AOX payload format.

## Phase 4

Return structured measurement data from:

``` ts
await scanner.measureAOX();
```

## Phase 5

Integrate into NutriScan.

------------------------------------------------------------------------

# Claude Development Rules

1.  Never remove logging until behavior is fully understood.
2.  Prefer clarity over cleverness.
3.  Every protocol assumption should include an explanatory comment.
4.  Update this document whenever new behavior is confirmed.
5.  Treat this document as the canonical specification.
6.  Do not change protocol behavior without updating the documentation.

------------------------------------------------------------------------

# Long-Term Goal

Produce a fully documented, open implementation of the BioZoom
VitalityCheck protocol consisting of:

-   Production TypeScript SDK
-   Complete protocol documentation
-   Automated tests
-   Browser demo
-   Electron support
-   Node.js support
-   No dependency on the Android application
