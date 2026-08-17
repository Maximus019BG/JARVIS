# Worked calculations

Every number below came out of `engineering_calc`. Run it yourself rather than copying —
the point of these is to show which formula to reach for and how to read what comes back,
not to be a lookup table.

Copper resistivity is **0.0225 Ω·mm²/m** — the value IEC 60364-5-52 App. G uses, which is
1.25 × the 20 °C figure because a loaded cable runs warm. Using 0.0175 under-states every
drop by a quarter. Aluminium is 0.036.

---

## A 32 A socket circuit, 40 m of 2.5 mm²

```
voltage-drop-1ph   L=40, I=32, A=2.5, rho=0.0225   →  23.04 V
voltage-drop-percent  drop=23.04, U=230            →  10.02 %  ✗ over the 5 % limit
```

Ten percent. Size it on the drop instead of guessing:

```
cable-csa-1ph  L=40, I=32, drop=11.5, rho=0.0225   →  5.01 mm², next size 6 mm²
```

`drop=11.5` is 5 % of 230 V. The answer is 6 mm², and the note says what it does not
cover: **that is the voltage-drop minimum only.** Still check ampacity — 6 mm² is 46 A by
reference method C, so 32 A is fine, and `protection-coordination Ib=32, In=32, Iz=46`
confirms the device.

The lesson: at 32 A a 40 m run is long, and 2.5 mm² is a 20 m cable.

## A lighting circuit, 6 A over 25 m of 1.5 mm²

```
voltage-drop-1ph      L=25, I=6, A=1.5, rho=0.0225  →  4.50 V
voltage-drop-percent  drop=4.5, U=230               →  1.96 %  ✓
```

Comfortably inside the 3 % lighting limit. Annotate it `L1 | mm2=1.5, A=6, m=25,
use=lighting` and `blueprint_check` will hold it to 3 %, not 5 %.

## A 7.5 kW three-phase motor, 50 m run

Start from shaft power, not from a guess at the current:

```
motor-current-3ph  P=7500, U=400, eff=0.88, pf=0.85   →  14.47 A
voltage-drop-3ph   L=50, I=14.47, A=4, rho=0.0225     →   7.05 V
voltage-drop-percent  drop=7.05, U=400                →   1.76 %  ✓
```

4 mm² is fine on volt drop. It is the **starting** current that decides the rest: a
direct-on-line motor draws six to eight times its running current for a second or two, so
the protective device needs a C or D curve, and the overload relay is set to the running
current, not the breaker rating.

`cable-csa-3ph L=50, I=14.47, drop=16` returns 1.76 mm² — the drop alone would allow
2.5 mm². Do not use it: ampacity, the motor's starting current and the overload setting all
push it up. **A calculation that returns a smaller cable than judgement suggests is a
calculation that is missing a constraint.**

## Protective conductor, 2 kA fault cleared in 100 ms

```
adiabatic-csa  I=2000, t=0.1, k=115   →  5.50 mm², next size 6 mm²
```

`k=115` is copper with PVC insulation, IEC 60364-4-43 Table 43A. XLPE is 143, aluminium
with PVC is 76 — using the wrong one under-sizes the conductor.

## Disconnection time

```
max-loop-impedance  Uo=230, Ia=160   →  1.44 Ω
```

`Ia` is the current that operates the device inside the required time — for a B16 MCB that
is five times In, so 80 A; for a C16 it is ten times, so 160 A. **The curve changes the
answer by a factor of two**, which is why the same cable can pass on a B curve and fail on
a C curve. IEC 60364-4-41 wants 0.4 s for a final circuit up to 32 A on TN, 5 s for a
distribution circuit.

Check the measured Zs against this, not the other way round.

## Low-voltage odds and ends

```
led-resistor      Us=5, Uf=2.1, If=0.02        →  145 Ω, dissipates 58 mW
voltage-divider   Uin=5, R1=10000, R2=20000    →  3.33 V
```

The LED note gives the dissipation, which is what tells you a 0.25 W part is fine. The
divider figure is the **unloaded** output — anything drawing current from the tap pulls it
down, so keep the divider current at least ten times the load current.

## The order to work in

1. `current-1ph` / `current-3ph` / `motor-current-3ph` — the design current Ib.
2. `cable-csa-*` — the cross-section the volt drop demands.
3. Ampacity from IEC 60364-5-52 for the actual installation method, with grouping and
   ambient correction factors applied.
4. `protection-coordination` — Ib ≤ In ≤ Iz.
5. `adiabatic-csa` — the protective conductor.
6. `max-loop-impedance` — disconnection.

Skipping step 3 is the usual mistake. The tables in `blueprint_check` are reference
method C only — clipped direct, PVC, copper, 30 °C ambient, ungrouped. A cable in
insulation, in a bunched group, or in a warm plant room carries considerably less, and no
tool here knows which of those applies. **Say on the drawing which method you assumed.**
