# Offline scoring-contract comparator

This tool compares two locally prepared scoring contract snapshots. It has no
network implementation and cannot submit a measurement.

```sh
npm run scoring:compare -- \
  --official diagnostics/scoring/official.json \
  --reconstructed diagnostics/scoring/nutriscan.json
```

Each snapshot contains `endpoint`, `method`, `query`, `multipart`,
`measureJson`, safe request headers, and session-presence flags. Put either the
exact `MeasurementBlocks` string in `measureJson.MeasurementBlocks`, or provide
only `MeasurementBlocksLength` and `MeasurementBlocksSha256`. Comparison output
contains only length/hash—not the raw measurement payload. Authorization and
cookie values are never compared or printed; record only the boolean presence
flags under `session`.

The multipart boundary is runtime-generated and intentionally ignored as a
value. The effective Content-Type is compared after replacing its boundary with
`<generated>`.
