# EN and Eurocode reference

Cite the clause, not the number alone. And say which country: every Eurocode has a
**National Annex** that sets the values left open, and accessibility and fire rules are
national law rather than EN — Part M and Approved Document B in England, the DIN 18040
series in Germany, NF P in France, Наредба №4 and №РД-02-20-3 in Bulgaria.

Numbers in these tables are the common EN or widely-adopted values. They are a starting
point for a drawing, not a compliance check.

## Eurocodes

| Code | Covers |
|---|---|
| EN 1990 | Basis of design — load combinations, partial factors, serviceability |
| EN 1991-1-1 | Densities, self-weight, imposed loads |
| EN 1991-1-2 | Actions on structures exposed to fire |
| EN 1991-1-3 | Snow loads |
| EN 1991-1-4 | Wind actions |
| EN 1992 | Concrete |
| EN 1993 | Steel |
| EN 1995 | Timber |
| EN 1996 | Masonry |
| EN 1997 | Geotechnical design |

**EN 1990 §6.4.3.2 eq. 6.10** is the one to quote for ULS: `1.35 Gk + 1.5 Qk` with the
recommended partial factors.

**EN 1990 A1.4** covers serviceability deflection limits. The ratio is set nationally;
span/250 is a common floor for total deflection and span/300 to span/350 under imposed load
alone.

### EN 1991-1-1 imposed floor loads

| Category | Use | Typical qk |
|---|---|---|
| A | Domestic and residential | 1.5–2.0 kN/m² |
| B | Offices | 2.0–3.0 kN/m² |
| C | Areas of congregation | 3.0–5.0 kN/m² |
| D | Shopping | 4.0–5.0 kN/m² |
| E | Storage and industrial | 7.5 kN/m² and up |

`engineering_calc imposed-floor-load` returns these with the caveat attached. The exact
value is a National Annex decision.

### Material properties for the formulas

| Material | E (N/mm²) |
|---|---|
| C16 timber | 8,000 |
| C24 timber | 11,000 |
| Glulam GL24h | 11,500 |
| Steel S275 / S355 | 210,000 |
| Concrete C25/30 | ~31,000 |

Timber E values are mean; design to EN 1995 uses characteristic and modification factors
that these formulas do not apply.

## Building physics

| Standard | Covers |
|---|---|
| EN ISO 6946 | Thermal resistance and transmittance of building components |
| EN ISO 13789 | Transmission and ventilation heat transfer coefficients |
| EN ISO 10211 | Thermal bridges — numerical calculation |
| EN ISO 13788 | Internal surface temperature and interstitial condensation |
| EN 16798-1 | Indoor environmental input parameters — ventilation, temperature |
| EN 12464-1 | Lighting of indoor work places |
| EN 17037 | Daylight in buildings |
| EN ISO 717 | Acoustic rating |

Surface resistances from EN ISO 6946: Rsi 0.13 for a wall, 0.10 for a ceiling with upward
heat flow, 0.17 for a floor with downward flow; Rse 0.04 in all cases.

Conductivities (λ, W/m·K) for a first pass: mineral wool 0.035, PIR 0.022, EPS 0.038,
timber 0.13, plasterboard 0.21, aerated block 0.15, dense block 1.1, brick 0.77,
concrete 2.0, steel 50.

## Accessibility

**EN 17210** is the European accessibility standard for the built environment. It is
functional rather than prescriptive, so the dimensions below are the widely-used values
that national regulations converge on.

| Thing | Value |
|---|---|
| Door clear width | 800 mm minimum, 850–900 mm preferred |
| Corridor | 1200 mm, 1500 mm where wheelchairs pass |
| Turning circle | 1500 mm diameter |
| WC transfer space | 1500 × 1500 mm beside the pan |
| Ramp gradient | 1:20 preferred, 1:12 maximum for a short run |
| Ramp landing | every 500 mm of rise, 1500 mm long minimum |
| Accessible parking bay | 3600 mm wide including the transfer zone |
| Lift car | 1100 × 1400 mm (EN 81-70 type 1) |
| Handrail height | 900–1000 mm |
| Controls and switches | 750–1200 mm above floor |

## Stairs

Numbers here are the common private-stair values; public and institutional stairs are
more demanding, and both are national.

| Thing | Private stair |
|---|---|
| Maximum rise | 190–220 mm |
| Minimum going | 220–250 mm |
| 2R + G | 550–700 mm, 600–650 the comfort band |
| Maximum pitch | 42° |
| Minimum headroom | 2000 mm |
| Minimum width | 800–900 mm |
| Handrail | 900–1000 mm above pitch line |
| Guarding | 1100 mm at a landing |

**Risers must all be equal within a flight.** That constraint, not the maximum, is what
sets the riser dimension.

## Standard dimensions

| Component | Metric size |
|---|---|
| Brick (EU format) | 240 × 115 × 71 mm, 250 × 120 × 65 in some markets |
| Brick (UK) | 215 × 102.5 × 65 mm, 225 × 75 with joint |
| Block | 440 × 215 mm face, 100/140/215 thick |
| Plasterboard | 1200 × 2400/2700/3000 mm, 12.5 or 15 mm |
| Stud partition | 100 mm overall (70 mm stud plus board) |
| Cavity wall | 300 mm overall — 102.5 outer, 100 cavity, 100 inner |
| Storey height | 2700–3000 mm floor to floor |
| Clear ceiling | 2400 mm minimum habitable |
| Door leaf | 626/726/826/926 × 2040 mm |
| Structural opening | leaf + 75 mm width, + 60 mm height |
| Window module | 600 mm increments |
| Worktop | 900 mm high, 600 mm deep |
| Kitchen unit | 600 mm wide standard, 300/1000 also common |

## Drafting

**ISO 128** — general presentation. **ISO 5457** — sheet sizes. **ISO 7200** — title block
data fields. **ISO 3098** — lettering. **ISO 5455** — scales.

ISO 128 line types, and what this toolset can and cannot do:

| Line | Meaning | Available? |
|---|---|---|
| Continuous thick | Visible edges, the cut in a section | yes — `width` |
| Continuous thin | Dimensions, hatching, leaders | yes |
| Dashed | Hidden edges, anything above the cut plane | yes — `dash: "dashed"` |
| Long-dash dot | Centre lines, axes | approximated with `dash: "dotted"` |
| Long-dash double-dot | Adjacent parts, outlines before change | not available |
| Continuous thin freehand | Break lines | use the `break-line` symbol |

There is no hatching or fill in the document schema, so section poché, material hatching
and filled poché walls cannot be drawn. Use layer colour and a key, and say so in a note.
