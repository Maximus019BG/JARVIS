# Engineering

Code: `tui/src/engineering/` · Verified: 2026-10-13 @ c292f2f

## Purpose
A table of named engineering formulas (electrical, structural, building physics, low-voltage/IoT)
that the agent evaluates instead of recalling, each tagged with the standard it comes from.
It exists because drafting agents run with `bash: false` and need a way to compute, and a
computed number with its clause attached can be checked. Design aids only, not certification.

## How it works
1. Four private groups (`electrical`, `structural`, `buildingPhysics`, `lowVoltage`) are spread
   into `FORMULAS`. Each entry is built with `def`, which infers input names from `inputs` so
   `compute` cannot reference an undeclared input (a compile error rather than a silent `NaN`).
2. `evaluate(name, values)`:
   - unknown name → `FormulaError`;
   - any declared input missing or non-finite → `FormulaError` listing every input with its unit;
   - any extra key → `FormulaError` (a stray key is usually a misremembered input name);
   - `compute` may return a number or `{value, note}`;
   - a non-finite result → `FormulaError` ("check for a division by zero");
   - returns `{value (rounded to 6 places), unit, describe, standard?, note?}`.
3. The `engineering_calc` tool (`tools/calc.ts`) lists formulas (optionally filtered by `search`,
   every word must match name, description or standard) or evaluates one, turning
   `FormulaError` into a `ToolError` the model can correct.
4. `blueprint/check.ts` calls `evaluate` directly (`protection-coordination`,
   `voltage-drop-1ph`/`-3ph`, `voltage-drop-percent`) and uses `RHO` for its electrical checks.

## Files
| File | Responsibility |
|---|---|
| `tui/src/engineering/formulas.ts` | `FORMULAS`, `evaluate`, `FormulaError`, `Formula`, `FormulaResult`, constants `RHO` and `K_FACTOR` |

## Interfaces

**Exports**: `FORMULAS: Record<string, Formula>`, `evaluate(name, values)`, `FormulaError`,
`RHO` (Ω·mm²/m at operating temperature: copper 0.0225, aluminium 0.036), `K_FACTOR`
(IEC 60364-4-43 Table 43A: `cu-pvc` 115, `cu-xlpe` 143, `al-pvc` 76, `al-xlpe` 94).

**Agent tool** `engineering_calc` (defined in [tools](../tools/README.md)): `formula?`,
`inputs?` (name → number), `search?`. No formula = list. Ungated, deferred under `lazyTools`.

**Formulas** (79 at this commit; call `engineering_calc` with no arguments for inputs and units):

| Group | Count | Names |
|---|---|---|
| Electrical | 29 | `ohms-law-voltage`, `ohms-law-current`, `ohms-law-resistance`, `power-dc`, `power-resistive`, `power-ac-1ph`, `power-ac-3ph`, `current-1ph`, `current-3ph`, `motor-current-3ph`, `voltage-drop-1ph`, `voltage-drop-3ph`, `voltage-drop-percent`, `cable-csa-1ph`, `cable-csa-3ph`, `conductor-resistance`, `protection-coordination`, `earth-fault-current`, `max-loop-impedance`, `adiabatic-csa`, `led-resistor`, `voltage-divider`, `rc-time-constant`, `rc-cutoff`, `lc-resonance`, `capacitor-energy`, `transformer-ratio`, `power-factor-correction`, `diversity-load` |
| Structural | 18 | `second-moment-rect`, `section-modulus-rect`, `moment-udl-simple`, `moment-point-simple`, `moment-udl-cantilever`, `moment-point-cantilever`, `deflection-udl-simple`, `deflection-point-simple`, `deflection-udl-cantilever`, `deflection-point-cantilever`, `bending-stress`, `deflection-limit`, `euler-buckling`, `load-udl-from-area`, `load-combination-uls`, `imposed-floor-load`, `concrete-volume`, `masonry-units` |
| Building physics | 15 | `thermal-resistance`, `u-value`, `heat-loss-fabric`, `heat-loss-ventilation`, `dew-point`, `ventilation-rate`, `air-change-rate`, `stair-rule`, `stair-run`, `stair-pitch`, `ramp-length`, `daylight-factor`, `illuminance-target`, `lumens-required`, `room-area` |
| Low voltage / IoT | 17 | `battery-life`, `average-current-duty`, `dc-wire-drop`, `i2c-pullup`, `i2c-pullup-min`, `adc-resolution`, `regulator-dissipation`, `buck-input-current`, `heatsink-thermal`, `mosfet-conduction-loss`, `poe-budget`, `free-space-path-loss`, `link-budget`, `fresnel-radius`, `pwm-average-voltage`, `current-budget`, `capacitor-hold-up` |

## Data and state
None. The module is pure: no I/O and no imports, so it can be bundled anywhere.

## Depends on / used by
- Depends on: nothing.
- Used by: `tui/src/tools/calc.ts` (`engineering_calc`), `tui/src/blueprint/check.ts`
  ([blueprint-system](../blueprint-system/README.md)). Through `blueprint/check.ts` it is also
  compiled into the web app, which imports the blueprint engine via the `@blueprint/*` path alias
  in `web/tsconfig.json`; keep it free of Node or Bun APIs.
- Referenced by prompts: the shipped `draftsman`, `mechanic`, `butler` and `analyst` agents and
  the blueprint skills tell the model to use `engineering_calc` ([extensions](../extensions/README.md)).

## Gotchas
- Units are fixed per input and stated in `inputs` (e.g. `C` in farads, not µF). The tool listing
  shows them; the model must convert.
- Every input is required, and extra inputs are rejected. There are no optional parameters; a
  variant needs its own formula name.
- `RHO` is the warm-conductor resistivity (1.25 × the 20 °C value) that IEC 60364-5-52 App. G
  uses for voltage drop; using the 20 °C figure under-states the drop by a quarter.
- `standard` is optional: 37 of the 79 entries carry one.
- Results are rounded to 6 decimal places in `evaluate`; notes may round further for display.
- The output is a design aid. Anything built from it needs a competent person's sign-off.

## Tests
Run from `tui/`: `bun test test/engineering.test.ts`.

| Test | Covers |
|---|---|
| `tui/test/engineering.test.ts` | table shape, each group's formulas against known values, `evaluate` error handling |
| `tui/test/blueprint-check.test.ts` | electrical checks that call `evaluate` |
