# IEC 60617 symbol index

Every name here is a real entry in the `electrical` library. Use
`blueprint_symbol action:"list"` with a query to see descriptions, standard references and
port counts; use `action:"place"` to put one on a drawing.

Names are unique across libraries in almost every case, so `resistor` works as well as
`electrical/resistor`. Qualify it when a name also exists in the `iot` or `building`
library — `ground`, `led`, `buzzer`, `motor-dc`, `valve-solenoid`, `water-heater` all do.

## Port order

Two-terminal parts report ports left to right along their own X axis: port 1 at −10.16,
port 2 at +10.16 before rotation. Where the order is not obvious the `describe` text spells
it out — for a transistor it says which is base, collector and emitter.

Rotating a placement rotates its ports, and `blueprint_symbol` returns the transformed
coordinates. Never work them out yourself.

## Passives

`resistor` `resistor-zigzag` `resistor-variable` `potentiometer` `thermistor` `varistor`
`ldr` `capacitor` `capacitor-polarised` `capacitor-variable` `inductor` `inductor-core`
`inductor-variable` `crystal` `ferrite`

The IEC resistor is a plain rectangle. `resistor-zigzag` is there only for a drawing that
already mixes conventions — do not introduce it into an otherwise IEC sheet.
`potentiometer` has three ports: end, wiper, end.

## Semiconductors

`diode` `diode-zener` `diode-schottky` `diode-tvs` `led` `photodiode` `bridge-rectifier`
`bjt-npn` `bjt-pnp` `mosfet-n` `mosfet-p` `jfet-n` `thyristor` `triac` `optocoupler`

A diode's port 1 is the anode and port 2 the cathode — the bar end. Transistors report
base, collector, emitter in that order. `bridge-rectifier` reports AC, AC, +, −.

## Sources, earths and rails

`cell` `battery` `source-dc` `source-ac` `source-current`
`ground` `earth-protective` `ground-chassis` `ground-clean`
`supply-plus` `supply-minus` `supply-line` `supply-neutral`

Use `earth-protective` for PE, `ground-clean` for an instrumentation reference, and
`ground-chassis` for a bonded enclosure. They are different things and drawing them the
same way loses information a commissioning engineer needs.

## Switchgear and control

`switch-spst` `switch-spst-nc` `switch-spdt` `switch-dpst` `pushbutton-no` `pushbutton-nc`
`switch-emergency` `switch-limit` `switch-key` `switch-rotary` `isolator`
`relay-coil` `relay-coil-delay-on` `contact-no` `contact-nc` `contact-changeover`
`contactor-3p` `overload-thermal`

For a control circuit, draw the coil and its contacts as separate symbols and tie them
together with the same reference — `K1` on the coil, `K1` on each contact. That is how a
ladder diagram is read.

## Protection

`fuse` `fuse-switch` `mcb-1p` `mcb-2p` `mcb-3p` `rcd-2p` `rcd-4p` `rcbo` `mccb`
`surge-arrester`

Label every protective device with its rating and, for an MCB, its curve: `Q1 B16`,
`Q2 C32`. An RCD wants its sensitivity too: `RCD1 40A 30mA`. B curve for resistive and
lighting loads, C for motors and anything with inrush.

## Machines, transformers and loads

`motor-dc` `motor-ac-1ph` `motor-ac-3ph` `generator` `motor-servo` `motor-stepper`
`solenoid` `valve-solenoid` `transformer` `transformer-coil` `transformer-3ph`
`transformer-current` `autotransformer` `bell` `buzzer` `speaker` `microphone` `antenna`
`heating-element`

`motor-ac-3ph` reports its three ports as U, V, W. `transformer-3ph` is drawn Dyn — change
the text if the vector group is different.

## Measuring instruments

`ammeter` `voltmeter` `wattmeter` `ohmmeter` `meter-kwh` `meter-frequency`
`meter-powerfactor` `thermometer` `test-point`

An ammeter goes in series and a voltmeter in parallel. Draw them that way or the drawing
is wrong regardless of the symbol.

## Installation plan symbols (IEC 60617-11)

These go on a floor plan at building scale, not on a schematic grid. Scale them up to suit
the plan — at 1:50 a symbol drawn at 10 mm reads about right.

**Outlets** `socket-1g` `socket-2g` `socket-switched` `socket-3ph` `socket-outdoor`
`outlet-data` `outlet-tv` `outlet-telephone`

**Switching** `switch-1way` `switch-2way` `switch-intermediate` `switch-2gang`
`switch-pull` `dimmer`

**Lighting** `lamp` `lamp-wall` `luminaire-linear` `luminaire-emergency`
`luminaire-downlight` `exit-sign`

**Distribution** `distribution-board` `junction-box` `ceiling-rose` `cable-rising`
`cable-falling` `isolator-local`

**Fixed appliances** `fan-point` `water-heater` `cooker-point` `thermostat`

**Detection** `smoke-detector` `heat-detector` `call-point` `motion-sensor`

`switch-pull` is the one to use in a bathroom — a plate switch inside the zones is not
permitted. Two-way switching needs `switch-2way` at both ends; add `switch-intermediate`
for every position in between.

## Logic and wiring furniture

`gate-and` `gate-or` `gate-not` `gate-nand` `gate-nor` `gate-xor` `gate-buffer`
`amplifier` `opamp`
`junction-dot` `crossing-no-connect` `terminal` `terminal-block` `plug-socket`
`link-removable` `cable-shielded` `cable-multicore` `enclosure`

Gates are the IEC rectangular form with a qualifying symbol (`&`, `≥1`, `=1`) rather than
the distinctive American shapes.

**`junction-dot` is the one to be disciplined about.** A dot means connected; a plain
crossing means not connected. Use `crossing-no-connect` when a hop reads more clearly.
Every T where three wires meet gets a dot.

`enclosure` is a dashed boundary — scale it to whatever it surrounds, and use it to show
what is inside one panel.
