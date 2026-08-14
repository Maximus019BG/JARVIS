---
name: iot-blueprints
description: Drawing IoT wiring diagrams, block diagrams, pinout maps and enclosure layouts — ESP32/Pico/Arduino boards, sensors and actuators at real footprints on the 2.54 mm grid, I2C/SPI/UART bus conventions, level shifting, pull-up sizing, power and battery budgets, and the annotation grammar that lets blueprint_check catch pin clashes and bus voltage mismatches. Use whenever wiring up a microcontroller, a sensor or a module, planning a battery-powered device, or drawing a system block diagram.
---

# IoT blueprints

Wiring diagrams and block diagrams for microcontroller work, drawn at real footprints in
millimetres on the 2.54 mm grid. **This is a drawing aid. Check every pin against the
board's own datasheet before you solder anything.**

## Conventions (the same in every blueprint skill)

- **Y points down.** `[0, 10]` is below `[0, 0]`, like SVG.
- **Angles are degrees clockwise from +X.** 0° right, 90° down, 180° left, 270° up.
- Millimetres unless the drawing says otherwise. Never mix units in one sheet.
- Batch one whole feature per `blueprint_edit` or `blueprint_symbol` call.
- Explicit entity ids must **not** start with `e` followed by a digit.
- Read the `blueprint-drafting` skill for coordinates, entity choice and dimensioning.

## The 2.54 grid

**2.54 mm is 0.1 inch** — the pitch of every pin header, DIP package and breadboard row.
Every board in the library has its pins on that pitch at its real footprint, so a wiring
diagram doubles as a rough enclosure layout and a breadboard plan.

Put every symbol origin and every wire on a multiple of 2.54. Off-grid placement is why
diagrams end up with wires that nearly meet a pin.

## The loop

1. `blueprint` `action: "create"`. A4 landscape suits most wiring diagrams; use a bigger
   `viewBox` for a board-level layout at real size.
2. `blueprint_symbol` `action: "list"` `domain: "iot"` with a query to find parts.
3. `blueprint_symbol` `action: "place"` — the whole diagram in one call. The reply gives
   each part's **ports already transformed**, in the order its pin labels are drawn.
4. `blueprint_edit` to wire between those coordinates. `junction-dot` wherever wires meet.
5. `engineering_calc` for the power budget, pull-ups, regulator dissipation, battery life.
6. Annotate, then `blueprint_check` `domain: "iot"`.

Board ports are reported **left column top-to-bottom, then right column top-to-bottom**,
matching the pin labels drawn on the symbol. Port 1 of an `esp32-devkit` is `3V3`.

## Layers

The names matter — `blueprint_check` reads them:

| Layer name | Holds |
|---|---|
| `devices` | every part with its current and bus annotation |
| `power` or `supply` | the source, with its `supplyMA=` |
| `bus` | I²C / SPI / UART runs |
| `signals` | GPIO and interrupt wiring |
| `enclosure` | mechanical outline, mounting holes |
| `annotation` | notes, net labels |

## Annotation grammar

The schema stores geometry, not meaning, so kind comes from the layer name and parameters
from a `text` entity on that layer shaped exactly like this:

```
REF | key=value, key=value
```

```
PSU | supplyMA=1000                                    on layer "supply"
U1  | mA=250, v=3.3, bus=i2c, pin=GPIO21/GPIO22        on layer "devices"
U2  | mA=6, v=3.3, bus=i2c, addr=0x76                  on layer "devices"
LS1 | mA=1, v=5, bus=i2c, shift=yes                    on layer "devices"
```

| Key | Means |
|---|---|
| `supplyMA` | what the source can deliver — put it on the source, not a load |
| `mA` | **peak** current of this device, not average |
| `v` | its logic / supply voltage |
| `bus` | which bus it is on: `i2c`, `spi`, `uart` |
| `addr` | bus address — written as you would write it, `0x76` stays `0x76` |
| `pin` | MCU pins it claims, `/`-separated |
| `shift` | `yes` on a level shifter, which is what silences the mixed-voltage error |

`blueprint_check domain:"iot"` then catches: a supply that cannot meet the peak draw with
20 % headroom, two devices claiming the same address, two devices on the same pin, and a
bus mixing 3.3 V and 5 V with no shifter declared.

**Anything the checker cannot read is reported as NOT CHECKED, never as a pass.** A device
with no `mA=` is left out of the power budget and the report says so.

## The four mistakes worth designing against

1. **Peak current, not average.** An ESP32 draws 250–500 mA in a transmit burst against
   maybe 80 mA idle; a SIM800L pulls 2 A. Size the supply for the peak and add a bulk
   capacitor — `capacitor-hold-up` gives the size. A regulator that sags on TX gives a
   device that reboots at random and looks like a firmware bug for a week.
2. **3.3 V and 5 V on one bus.** Driving a 3.3 V input from a 5 V output exceeds its
   absolute maximum rating. It often appears to work, then fails weeks later. Use
   `level-shifter` and annotate it `shift=yes`.
3. **A servo or motor on the MCU's regulator.** A 9 g servo stalls at about 1 A. Give
   motion its own supply and share only the ground.
4. **No flyback diode on an inductive load.** Relays, solenoids and motors need one across
   the coil, or the switching transistor dies.

## Power

Work it out, do not estimate:

- `average-current-duty` — the average current of a duty-cycled device
- `battery-life` — with a realistic 0.7–0.85 derate
- `current-budget` — total peak against the supply, with headroom
- `regulator-dissipation` — a linear regulator over 1 W wants a buck instead
- `heatsink-thermal` — if it really must be linear
- `dc-wire-drop` — matters far more at 5 V than at 230 V
- `capacitor-hold-up` — bulk capacitance for a burst

## Buses

- `i2c-pullup` and `i2c-pullup-min` size the pull-ups. 4.7 kΩ is the safe 3.3 V default;
  a long or fast bus wants 2.2 kΩ. Only **one** pair on the bus — many breakout boards
  include their own, and four boards in parallel is 1.2 kΩ.
- SPI needs a chip select per device; I²C needs a unique address per device.
- UART: TX goes to the other end's RX. Crossing them is the classic mistake and the
  `uart-bus` symbol labels both ends to make it obvious.
- RS-485 and CAN need 120 Ω termination at **both** ends of the bus, not at each device.

## What to read next

- `references/symbols.md` — the full IoT symbol index, board pinouts and port order.
- `references/buses.md` — I²C/SPI/UART/1-Wire/CAN conventions, addressing, level shifting.
- `references/power.md` — worked budgets, battery life, regulators, PoE.
