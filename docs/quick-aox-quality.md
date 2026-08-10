# Quick AOX score quality

## Scope and evidence boundary

This document describes interpretation of BioZoom Quick AOX scoring responses.
It is not scanner-protocol behavior and does not belong in `docs/protocol.md`.

- **Hardware-confirmed:** the scanner package can acquire and reconstruct a
  complete AOX measurement. Scanner behavior does not define `aox_q`.
- **Runtime-confirmed:** one authorized measurement-35 scoring response on
  2026-08-09 contained `aox: 5.6`, `aox_q: 40`, the documented
  `error_prediction` object, and additional fields. Code 40 was accepted by
  the APK-compatible quality gate.
- **APK-confirmed:** VitalityCheck 0.50.107 applies the comparisons and explicit
  cases below after scoring.
- **NutriScan policy:** `@nutriscan/scoring` provides a pure parser and an
  injectable APK-compatible default interpreter. It performs no workflow or
  hardware action.

The missing root document `BIOZOOM_PROTOCOL_AND_IMPLEMENTATION.md` supplies no
additional evidence. APK findings are version-specific and are not claimed as
universal BioZoom or scanner rules.

## Parsing and preservation

`parseQuickAoxResponse()` requires a non-array object with a finite numeric
`aox`. It reports malformed or missing scores as parse failures. Quality is
handled independently:

- finite numeric `aox_q`: preserved with state `valid`;
- absent, null, or non-finite/non-numeric `aox_q`: preserved through
  `rawQualityCode`, with state `missing`, `null`, or `invalid`;
- `error_prediction`: preserved exactly as received, including null or an
  unfamiliar shape;
- the complete input object: preserved as `rawResponse`, including unknown
  current or future server fields.

Parsing does not decide quality. `interpretQuickAoxQuality()` consumes a parsed
response and a policy. Missing, null, or invalid quality values produce
`unable-to-decide`; they are never silently accepted.

## APK-compatible default policy

| `aox_q` | Routing | Reason code | Recognized by default |
|---:|---|---|---|
| `40` | accept | none | yes; runtime example exists |
| any other finite value `< 50` | accept | none | no |
| `50` | rescan | `surrounding-light-or-incomplete-coverage` | yes |
| `60` | rescan | `handling-coverage-or-movement` | yes |
| `70` | rescan | `transmission-or-integrity` | yes |
| `80` | resolve device condition | `low-led-voltage` | yes |
| `90` | resolve device condition | `low-scanner-battery` | yes |
| `100` | stop normal result flow | `prototype-data-received` | yes |
| other finite value `>= 50` | rescan | `generic-quality-rejection` | no |

Recognition and routing are intentionally independent. For example, 37, 44,
45, and negative values satisfy the APK's literal `< 50` acceptance comparison,
but NutriScan does not assign them a defined meaning. The dormant switch cases
44 and 45 are unreachable in the analyzed APK and do not establish semantics.
Likewise, 55 or a value above 100 reaches generic APK rejection without becoming
a recognized code.

The explicit cases are APK-confirmed application behavior. Only code 40 has a
saved runtime-confirmed NutriScan scoring example. Fixtures for all other codes
are synthetic and test the APK-derived policy rather than server occurrence.

## Diagnostics

Active APK code retains, merges, and can rank `error_prediction` values. It does
not use the older disabled `>= 0.5` field-to-instruction mapper in the Quick AOX
decision. NutriScan therefore preserves `error_prediction` as opaque diagnostic
data and does not derive acceptance, medical meaning, or scanner instructions
from QNN, position, brightness, pressure, jitter, or `total_error` values.

`aox_q` drives the default quality decision. This does not prove how the server
calculates `aox_q`, or that any diagnostic field has a stable public meaning.

## Presentation and workflow boundaries

Machine-readable decisions contain an action and reason code. Presentation is
separate:

- `APK_QUICK_AOX_PRESENTATION_REFERENCE` records APK localization keys and
  evidence-derived English meanings for reference;
- `DEFAULT_QUICK_AOX_PRESENTATION` is NutriScan-owned replaceable English copy;
- applications may localize or replace that copy without changing decisions.

The interpreter does not start a rescan, navigate, delete measurements, retry,
contact BioZoom, or issue scanner commands. Code 100 is `stop`, not an ordinary
rescan. Codes 80 and 90 require a device condition to be resolved before an
application chooses whether to scan again. The APK's separate scanner-battery
prewarning uses scanner/application state and is deliberately excluded.

## Configuration and future use

The APK threshold and switch are hardcoded in the analyzed implementation, but
the chosen stages, navigation, copy, generic error ranking, and some surrounding
deletion/repetition behavior depend on downloaded application configuration.
`QuickAoxQualityPolicy` is therefore injectable. A reviewed deployment policy
can change both classification and recognition without changing parsing.

`QuickAoxResult` preserves score, quality, diagnostics, decision, and raw server
response. It can later be used as an input to Precision AOX orchestration, but
this module implements no Precision AOX, HRV, or Vitality behavior.

## Remaining unknowns

- Whether values other than 40 and the explicit APK cases occur in production.
- Server-side meaning, scale, and calculation of `aox_q` and diagnostic fields.
- The active downloaded stage graph and customer-specific copy/navigation.
- Whether rejected Quick AOX responses are ultimately retained or removed by a
  particular configured workflow.
- Any Quick AOX retry limit; none is encoded by this interpreter.
- Whether another application or APK version uses different thresholds/cases.
