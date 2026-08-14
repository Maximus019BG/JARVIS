# Building physics and structure, worked

Every number below came out of `engineering_calc`. Run it yourself rather than copying.

---

## Sizing a domestic floor joist

A 4 m span, 47 × 195 C24 joists at 400 mm centres.

```
imposed-floor-load  category=1              →  2.0 kN/m²  (EN 1991-1-1 Category A)
load-combination-uls  Gk=0.5, Qk=2.0        →  3.675 kN/m²  (1.35 Gk + 1.5 Qk)
load-udl-from-area  q=3.675, width=0.4      →  1.47 kN/m per joist
second-moment-rect  b=47, h=195             →  29,041,594 mm⁴
moment-udl-simple  w=1.47, L=4              →  2.94 kNm
```

Then serviceability, on the **unfactored** load — about 1.0 kN/m per joist here:

```
deflection-udl-simple  w=1.0, L=4, E=11000, I=29041594   →  10.4 mm, span/383
deflection-limit  L=4, ratio=300                          →  13.3 mm
```

10.4 mm against a 13.3 mm limit: it passes, with not much in hand.

Two things to be careful about. **Deflection governs, not strength** — a timber floor
almost always fails serviceability before it fails bending, so check deflection first.
And **use the unfactored load for deflection and the factored load for bending** — mixing
them is the most common error in this calculation and it gives an answer that looks fine.

Category A is 1.5 to 2.0 kN/m² depending on the National Annex. The note says so; repeat
it on the drawing.

## A wall U-value

100 mm mineral wool at λ = 0.035 plus 100 mm of blockwork at λ = 0.15:

```
thermal-resistance  d=0.1, lambda=0.035   →  2.857 m²·K/W
thermal-resistance  d=0.1, lambda=0.15    →  0.667 m²·K/W
u-value  sumR=3.524, Rsi=0.13, Rse=0.04   →  0.271 W/m²·K
```

Inside the 0.15–0.30 band typical of EU new build, though tighter than that is common now.

This is the **one-dimensional** U-value. It does not include thermal bridging at junctions,
lintels or wall ties, which in a real assembly adds meaningfully to the heat loss. Say that
the figure is 1-D.

## Heat loss for a small house

60 m² of wall at U = 0.27, 180 m³ heated volume, 22 K temperature difference:

```
heat-loss-fabric      U=0.27, A=60, dT=22   →  356 W
heat-loss-ventilation  n=0.5, V=180, dT=22  →  653 W
```

Ventilation is nearly twice the wall loss. That is the usual shape once the fabric is
insulated: **the air becomes the problem**, which is the argument for heat recovery rather
than for more insulation.

Repeat `heat-loss-fabric` for every element — roof, floor, windows, doors — and add them.

## Condensation risk

```
dew-point  T=20, RH=65   →  13.2 °C
```

Any internal surface below 13.2 °C will condense at 20 °C and 65 % RH. That is the number
to check a cold bridge against: a reveal, a lintel, a wall–floor junction or an uninsulated
steel. Mould grows well before liquid water appears, from about 80 % surface RH, so treat
13.2 °C as optimistic rather than as a threshold with margin.

## A stair for a 2700 mm storey

```
stair-run  height=2700, maxRise=190, going=250
  →  3500 mm total going; 15 risers at 180 mm, 14 treads at 250 mm; 2R+G = 610
stair-rule   rise=180, going=250   →  610, within the usual private-stair limits
stair-pitch  rise=180, going=250   →  35.8°, within the 42° limit
```

Always work the riser count from the floor-to-floor height first. **Risers must be equal** —
you cannot have 14 at 190 and one odd one, so the height divides into a whole number and
the riser follows from that, not the other way round.

3500 mm of going plus a landing is the floor area a stair actually needs. Check it fits
before drawing the walls around it.

## A ramp

```
ramp-length  rise=450, gradient=20   →  9000 mm of run
```

9 m for a 450 mm rise at the preferred 1:20. At the 1:12 maximum it is 5.4 m but needs an
intermediate landing, because landings are required every 500 mm of rise — the tool says so
when the rise passes that.

## Lighting and ventilation

```
illuminance-target  task=2                        →  500 lux (EN 12464-1, office work)
lumens-required  E=500, A=20, UF=0.5, MF=0.8      →  25,000 lm
ventilation-rate  people=2, perPerson=7, area=60, perArea=0.7  →  56 l/s (201.6 m³/h)
air-change-rate  q=201.6, V=180                   →  1.12 ach
```

25,000 lm over 20 m² is about six 4,000 lm luminaires. The utilisation factor swings with
room proportions and surface reflectance — 0.5 is a mid estimate and a tall narrow room
will be well below it.

The EN 16798 rate is category II for a low-polluting building. Category I is higher;
a polluting building adds more per m².

## Where these stop

- No thermal bridging, no dynamic thermal modelling, no overheating check.
- No wind, snow or seismic actions — EN 1991-1-3 and 1991-1-4 are not implemented here.
- No fire engineering: escape distances, compartmentation and travel distances are not
  checked by anything in this toolset.
- The structural formulas are elastic, simply supported or cantilever, and take no account
  of lateral restraint, notching, bearing, or connection design.

Any of those matters and it needs an engineer, not a formula table.
