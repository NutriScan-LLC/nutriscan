# Quick AOX result presentation

NutriScan displays an accepted Quick AOX result on BioZoom's native **0–12 AOX scale**. The decimal `aox` returned by scoring is the displayed value without conversion to a percentage or a 0–100 score.

NutriScan presents the result with a lightweight SVG semicircular arc, giving the application a distinct visual treatment rather than reproducing BioZoom's horizontal bar. The arc gradient uses the exact color stops in VitalityCheck 0.50.107's bundled `assets/imgs/bar_aox.svg`:

| Offset | Color |
| ---: | :--- |
| 0% | `#ff798b` |
| 25.542316% | `#f48778` |
| 45.784044% | `#b9d40f` |
| 83.361965% | `#b9d40f` |
| 89.599538% | `#ff798b` |
| 100% | `#ff798b` |

These stops are visual presentation only. NutriScan does not interpret them as clinical thresholds or assign named score categories.

The marker position is `clamp(aox, 0, 12) / 12`, mapped from the left endpoint through the complete semicircular path to the right endpoint. The marker is a circle on the arc rather than a center-mounted needle. On entry it travels for two seconds along the SVG arc from the lower-left 0 endpoint to the result position; users who prefer reduced motion receive the marker immediately at its final position. The raw result is centered within the open arc. The 0–12 scale remains part of the visualization's accessible description rather than appearing as endpoint text. The 0–12 scale is confirmed, and the gradient is APK-derived. The linear score-to-marker mapping remains an inferred NutriScan presentation choice based on supplied BioZoom screenshots and APK behavior because the hosted BioZoom result-page source was not available for confirmation.

The displayed score is always the raw numeric `aox`. Measurement quality remains separate: `aox_q` and auxiliary response fields such as `aox_int_result`, `aox_floor_result`, `aox_fig`, `veggie_result`, and `intake_category` do not determine or replace the displayed AOX score.
