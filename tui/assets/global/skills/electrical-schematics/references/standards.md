# Which standard covers what

Cite the clause, not the number on its own. "16 A" is an assertion; "16 A, IEC 60364-5-52
Table B.52.4 reference method C" is something a reviewer can check and disagree with.

**Every national annex modifies this.** IEC 60364 is adopted as HD 60364 across CENELEC and
then amended country by country — BS 7671 in the UK, NF C 15-100 in France, VDE 0100 in
Germany, Наредба №3 in Bulgaria. The clause numbers below are stable; the *numbers inside
them* often are not. Say which country's rules you assumed.

## IEC 60364 — low-voltage electrical installations

| Part | Covers | Reach for it when |
|---|---|---|
| 60364-1 §312 | Supply characteristics, earthing arrangements | Choosing TN-S, TN-C-S or TT |
| 60364-4-41 | Protection against electric shock | Disconnection times, RCD requirements, Zs limits |
| 60364-4-42 | Protection against thermal effects | Fire barriers, surface temperatures |
| 60364-4-43 | Protection against overcurrent | The Ib ≤ In ≤ Iz rule (§433.1), adiabatic k factors (Table 43A) |
| 60364-5-51 | Common rules for equipment selection | External influences, IP ratings |
| 60364-5-52 | Wiring systems | Ampacity tables, installation methods, voltage drop (App. G) |
| 60364-5-53 | Switchgear and controlgear | Isolation and switching |
| 60364-5-54 | Earthing and protective conductors | PE sizing (§543), bonding |
| 60364-7-701 | Bathrooms | Zones 0/1/2 and what is permitted in each |
| 60364-7-712 | Photovoltaic systems | DC side of a solar installation |

### The clauses worth knowing verbatim

- **§433.1 — Ib ≤ In ≤ Iz.** Design current, then device rating, then cable capacity. The
  single most useful sentence in the standard.
- **§411.3.3 — 30 mA RCD** on socket outlets rated up to 32 A for general use, and on
  circuits in locations containing a bath or shower.
- **§411.4 — disconnection times on TN:** 0.4 s for final circuits up to 32 A at 230 V,
  5 s for distribution circuits.
- **App. G — voltage drop:** 3 % for lighting and 5 % for other uses, measured from the
  origin of the installation. Some national annexes state 4 %/6 % where the supply is from
  a private transformer.

## IEC 60617 — graphical symbols for diagrams

The symbol library follows this. The parts that matter here:

- **60617-2** — symbol elements, earths and general qualifiers
- **60617-3** — conductors and connectors, including the junction dot
- **60617-4** — passive components
- **60617-5** — semiconductors
- **60617-6** — energy generation and conversion: motors, transformers
- **60617-7** — switchgear, controlgear and protective devices
- **60617-8** — measuring instruments
- **60617-11** — architectural and topographical installation plans
- **60617-12** — binary logic elements (the rectangular `&` / `≥1` forms)

## Devices

| Standard | Covers |
|---|---|
| IEC 60898-1 | MCBs for household use — the B, C and D curves |
| IEC 60947-2 | Circuit breakers for industrial use — MCCBs |
| IEC 61008 / 61009 | RCCBs and RCBOs |
| IEC 60269 | Fuses (gG, aM classes) |
| IEC 61439 | Low-voltage switchgear assemblies — panel construction and verification |
| IEC 60529 | IP ratings |
| IEC 60228 | Conductors of insulated cables — the standard cross-sections |

### MCB curves

- **B** — trips at 3–5 × In. Resistive loads, lighting, sockets.
- **C** — 5–10 × In. Motors, transformers, anything with inrush.
- **D** — 10–20 × In. High-inrush industrial loads.

The curve sets the `Ia` used for the disconnection check, so it changes the maximum
permitted Zs by a factor of two or more between B and C.

## Earthing systems

| System | Arrangement | Consequence for the design |
|---|---|---|
| **TN-S** | Separate neutral and protective conductors all the way from the source | Low Zs, overcurrent devices can achieve disconnection |
| **TN-C-S (PME)** | Combined PEN from the source, split at the origin | Low Zs, but the PEN carries load current — do not use it for certain outdoor and caravan installations |
| **TT** | Local earth electrode, no earth from the supplier | Electrode impedance is high, so overcurrent devices will not disconnect: **RCD protection is required throughout** |
| **IT** | No direct earth connection, or via impedance | Industrial and medical use; needs insulation monitoring |

Declare one on the `earth` layer and stick to it. `blueprint_check` treats two different
systems on one installation as an error, because it usually means two drawings were merged
without reconciling them.

## Drafting

- **ISO 128** — general principles of technical drawing presentation
- **IEC 61082** — preparation of documents used in electrotechnology: how a schematic,
  a single-line diagram and a connection diagram differ, and what each is for
- **IEC 81346** — reference designation: the `-Q1`, `-K1`, `-W1` scheme

## Drawing types, and not confusing them

- **Schematic** — how the circuit works. Symbols placed for readability, not for position.
- **Single-line diagram** — one line stands for all three phases. For distribution.
- **Connection / wiring diagram** — which terminal goes to which terminal. For the installer.
- **Installation plan** — symbols on a floor plan at building scale. For the layout.

A drawing that tries to be two of these at once is usually good for neither. Pick one, say
which it is in the title, and draw a second sheet if the other is needed too.
