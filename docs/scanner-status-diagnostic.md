# Permissioned scanner status-only diagnostic

## Safety boundary

The development-only diagnostic performs exactly: connect, identify using the
existing V2 detection path, one strictly correlated `status` command, and
disconnect. It requires the operator to type `READ STATUS ONLY`. It contains
no measurement, hand-recognition, flash-read, delete, erase, reset/restart,
firmware, scoring, or network operation.

The complete `ParsedResponse` is retained only in the diagnostic runner's
memory. The UI renders a recursively sanitized copy. It removes scanner/network
identity and protocol-envelope keys including serial, host, IP, Wi-Fi name,
password/token/credential fields, chip IDs, UUIDs, call indexes, and `command`.
Raw bytes, raw frames, and raw response text are never rendered or logged.

## Status-field evidence

The recovered APK source map lists these fields as expected scanner status
material. Their presence in that client is **APK-confirmed**; it does not prove
that every scanner or firmware returns every field:

| Field | Evidence and current meaning |
| --- | --- |
| `product` | APK-confirmed status key; treated as scanner product/model text. |
| `sensor` | APK-confirmed status key; precise meaning varies by transport and remains partly unknown. |
| `sensor_firmware` | APK-confirmed firmware identifier; used by the APK to choose the hand-recognition firmware branch. |
| `sensor_temp` | APK-confirmed status key; unit and calibration are not established. |
| `battery_voltage` | APK-confirmed status key; numeric unit is presumed volts from naming but not independently confirmed. |
| `usb_voltage` | APK-confirmed status key; exact unit/thresholds are not independently confirmed. |
| `usb_charging` | APK-confirmed charging-state key; value schema varies/unknown. |
| `memory_free_64k_blocks` | APK-confirmed storage-health key; likely counts free 64 KiB units, but capacity semantics are not hardware-confirmed. |
| `memory_healthy` | APK-confirmed storage-health key; exact firmware criteria are unknown. |
| `wifi_firmware` | APK-confirmed firmware version used by APK branch selection. |
| `nuvoton_firmware` | APK-confirmed firmware version for newer scanner status. |
| `uptime` | APK-confirmed status key; unit is not documented here. |
| `svn` | APK-confirmed build/revision field; exact format is unknown. |
| `timestamp` | APK-confirmed scanner timestamp field; format/time basis may vary. |
| `production` | APK-confirmed status key; value schema and meaning remain unknown. |
| `meas_count_wifi` | APK-confirmed measurement-count-related key; relationship to USB flash records is unknown. |
| `capabilities` | APK-confirmed nested capability object. |
| `capabilities.SUPPORT_SPI_MEMORY` | APK-confirmed capability flag directly relevant to external measurement storage availability. |
| `capabilities.SUPPORT_CHARGE_CONTROL` | APK-confirmed capability flag. |
| `capabilities.SUPPORT_IDLE_TIMER` | APK-confirmed capability flag. |
| `capabilities.SUPPORT_MDNS` | APK-confirmed capability flag. |
| `capabilities.SUPPORT_USB_LEGACY_MODE` | APK-confirmed capability flag. |
| `capabilities.WITH_CHARGE_LED` | APK-confirmed capability flag. |
| `capabilities.CORE_DEBUG_LEVEL` | APK-confirmed capability/config value. |
| `busy` | Hardware-confirmed on this scanner: `1` immediately after measurement acknowledgment/during visible acquisition and `0` after completion. It is not a complete success criterion. |
| `last_measurement_nr` | Hardware-confirmed on this scanner; it can already equal the active measurement while `busy` is `1`, so it is not a completion indicator by itself. |

The APK also expects identity/network fields (`host`, `serial`, `ip`,
`wifi_name`, Wi-Fi strength, and a Nuvoton chip ID). Sensitive identity/network
values, including the transport-dependent `sensor` identity value, are
intentionally omitted from the displayed diagnostic.

The sanitizer preserves any additional scalar, array, or nested object fields
not matching the sensitive-key denylist. This allows previously unknown
`storage`, `flash`, `memory`, `error`, `capacity`, or measurement-count fields
returned by the connected firmware to appear without inventing their meaning.

Hardware-unique fields are always removed, including `sensor`,
`sensor_unique`, serial/UUID/chip identifiers, MAC addresses, and current or
future keys containing `unique`, `hardware_id`, `device_id`, `sensor_id`, or
`identifier`.

## Permissioned single bare-delete diagnostic

The development-only route `/diagnostics/scanner/delete-once` requires the
exact phrase `DELETE SCOPE UNKNOWN ONCE`. Its scanner-side deletion scope is
unknown and the UI treats it as destructive. One authorized run performs only:

1. connect and identify;
2. one sanitized status snapshot;
3. exactly one bare `delete` with required call-index correlation and a
   10,000 ms response ceiling;
4. one sanitized status snapshot; and
5. disconnect.

There is no retry or loop. The diagnostic has no path to `erase-chip`, `e`,
`flash_erase`, measurement, hand recognition, flash reads, or BioZoom. Only
sanitized acknowledgment metadata is rendered; raw response material and
hardware identifiers are omitted.

## Interpretation for the current failure

Evidence supporting persistent storage/state pressure would include zero or
very low `memory_free_64k_blocks`, `memory_healthy: false`, a storage/flash
error field, an unexpectedly high measurement count, or `busy` remaining set
while no measurement is visibly active. Normal free-memory/health values,
`busy: 0`, and no error/capacity indicators would weaken—but not completely
exclude—the storage hypothesis because the firmware's exact start-failure
contract remains unknown.
