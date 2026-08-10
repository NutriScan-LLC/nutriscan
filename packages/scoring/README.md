# NutriScan scoring boundary

This package converts a complete scanner `RawAoxMeasurementArtifact` into an
offline, evidence-labelled proposal for the BioZoom scoring transaction. It is
separate from `@nutriscan/scanner` and currently has no network transport.

The minimal future API boundary is:

```ts
RawAoxMeasurementArtifact
  -> buildOfflineBioZoomScoringProposal(...)
  -> OfflineBioZoomScoringProposal
  -> authorized scoring transport (not implemented)
  -> ParsedAoxScoringResult
```

An eventual authorized transport should accept only a reviewed proposal and
return both the raw service response and parsed `aox`, `aoxQ`, quality, and
error fields. Endpoint discovery, license authorization, session policy,
timeouts, retries, privacy controls, and server transmission remain outside
this package until BioZoom supplies a supported integration contract.

## Quick AOX response quality

The package also exports pure `parseQuickAoxResponse()` and
`interpretQuickAoxQuality()` operations. Parsing validates the score while
preserving the complete raw response, raw quality value, opaque
`error_prediction`, and unknown fields. Interpretation uses an injectable
policy; the default reproduces the active VitalityCheck 0.50.107 APK quality
gate.

Threshold routing and semantic recognition are separate. Thus an unknown code
such as 37 is accepted by the APK-compatible `< 50` gate but has
`recognizedCode: false`. Missing, null, or invalid quality codes produce
`unable-to-decide`. No quality API performs HTTP, scanner access, rescanning,
navigation, deletion, or retries. See `docs/quick-aox-quality.md` for the
evidence and decision table.

### Browser-safe scoring contract

Browser/framework code can import `buildQuickAoxScoringRequest()`,
`parseQuickAoxPreRequest()`, response parsing, and quality interpretation from
`@nutriscan/scoring/quick-aox`. That subpath does not transitively import Node
crypto, filesystem, HTTPS, or diagnostic CLIs. UUID creation is injected, and
exact reconstructed `MeasurementBlocks` is preserved in the general
runtime-confirmed `measure_json` contract.

The intended production route is browser to NutriScan backend to BioZoom. The
backend route is separate work. `new_pre_request_req: true` is explicitly
unsupported rather than triggering guessed repeat behavior.
