# Power, worked

Every number below came out of `engineering_calc`. Run it yourself rather than copying.

---

## Sizing a supply

Add up the **peak** current of everything on the rail, then check it with headroom:

```
current-budget  total=820, supply=1000, headroom=0.2   →  16 mA spare
```

820 mA of peaks against a 1 A supply leaves 16 mA once 20 % headroom is applied. That is a
supply with essentially nothing in hand — fine on a bench, marginal in a warm enclosure
with a cheap USB adapter.

**Peak, not average, and per-device.** An ESP32 idles at ~80 mA and takes 250–500 mA in a
transmit burst. A relay coil is ~70 mA while energised. A servo stalls at ~1 A. If you add
averages you will build something that browns out the first time two things happen at once.

Annotate each device `U1 | mA=250, v=3.3` and the source `PSU | supplyMA=1000`, and
`blueprint_check domain:"iot"` does this sum for you and complains when it does not
balance.

## A battery sensor node

An ESP32 waking for 3 s every 15 minutes to take a reading and send it:

```
average-current-duty  Iactive=160, tActive=3, Isleep=0.01, tSleep=897   →  0.543 mA
battery-life  capacity=2500, current=0.543, derate=0.8                  →  3704 h = 154 days
```

Five months on an 18650. The whole result rests on `Isleep=0.01` — 10 µA deep sleep. Leave
a regulator with 1 mA quiescent current in the circuit and the average becomes 1.5 mA and
the life drops to 55 days. **On a battery device, sleep current dominates everything.**

The note says it: measure the real average current before trusting the number. A power
profiler across the supply for one full cycle is worth more than any calculation here.

## Linear or buck

12 V in, 5 V out, 500 mA:

```
regulator-dissipation  Uin=12, Uout=5, I=0.5     →  3.5 W  ✗ needs a heatsink
buck-input-current  Uin=12, Uout=5, Iout=0.5, eff=0.9   →  0.23 A
```

3.5 W in a TO-220 is a part you cannot touch. The buck draws 231 mA from the 12 V rail
instead of 500 mA, and wastes about 0.28 W.

Rule of thumb: **linear below ~200 mA or a small drop, buck above.** A linear regulator is
still the right answer for a low-noise analogue rail, or when the drop is small — 5 V to
3.3 V at 100 mA is only 0.17 W.

If it must be linear, `heatsink-thermal` gives the thermal resistance you need. A negative
answer means no heatsink exists for that dissipation.

## Volt drop on a low-voltage rail

5 m of 22 AWG (0.34 mm²) carrying 2 A at 5 V:

```
dc-wire-drop  L=5, I=2, A=0.34, rho=0.0175   →  1.03 V — 20.6 % of a 5 V rail
```

Twenty percent. The far end sees 4 V. This is why a long WS2812 strip goes yellow at the
end and why a Pi at the end of a thin cable throws under-voltage warnings.

At 230 V a 1 V drop is nothing; at 5 V it is fatal. **Low-voltage wiring needs thicker
conductors than intuition suggests** — or power injection at both ends.

## Bulk capacitance for a burst

A 2 A burst with 0.3 V of allowed droop:

```
capacitor-hold-up  C=0.001, dU=0.3, I=2   →  0.15 ms
```

1000 µF holds a 2 A burst for 0.15 ms. A SIM800L transmit burst is around 0.6 ms, so this
is about four times too small — which is exactly why SIM800L modules are notorious for
resetting the MCU. Work backwards from the burst length: 0.6 ms at 2 A with 0.3 V droop
needs about 4000 µF.

Put it **at the module**, not at the regulator. Track resistance between them undoes the
whole point.

## I²C pull-ups

```
i2c-pullup  tr=1000, Cb=100    →  11.8 kΩ  (100 kHz standard mode, light bus)
i2c-pullup  tr=300,  Cb=150    →   2.4 kΩ  (400 kHz fast mode, longer bus)
i2c-pullup-min  Vdd=3.3, Vol=0.4, Iol=0.003   →  967 Ω
```

The answer is a **maximum** — pick the next standard value below it. 4.7 kΩ is the safe
3.3 V default; a fast or long bus wants 2.2 kΩ. Never go below the minimum from
`i2c-pullup-min`, or the bus drivers cannot pull the line low enough.

Estimate `Cb` at ~10 pF per device plus ~1 pF per cm of track or wire.

**Only one pull-up pair on the bus.** Most breakout boards ship with their own, so four
boards in parallel gives 1.2 kΩ, below the minimum, and the bus stops working as you add
sensors. Remove the on-board pull-ups from all but one.

## ADC resolution

```
adc-resolution  Vref=3.3, bits=12   →  0.806 mV per step
```

That is the theoretical step. Real accuracy is well below it once noise, INL and the
ESP32's own ADC non-linearity are counted — treat a 12-bit ESP32 reading as about 9 usable
bits unless you average and calibrate.

## A LoRa link

868 MHz over 5 km, 14 dBm (the EU limit), 2 dBi antennas each end:

```
free-space-path-loss  f=868, d=5      →  105.2 dB
link-budget  Ptx=14, Gtx=2, Grx=2, loss=105   →  −87 dBm
fresnel-radius  D=5, f=0.868          →  20.8 m; keep 12.5 m clear at mid-path
```

−87 dBm against an SF12 sensitivity near −137 dBm is 50 dB of margin, which sounds
comfortable — and is, in **free space**. A real path through buildings and trees loses far
more, and the Fresnel figure is the catch: you need 12.5 m of vertical clearance at the
midpoint even with clear line of sight. Over 5 km of flat ground with a mast at each end,
that is rarely there.

Treat the free-space number as a best case that will never be met, and design for 20 dB
less. Remember the 1 % duty cycle limit in most EU 868 MHz sub-bands.

## PoE

```
poe-budget  standard=1   →  12.95 W at the device (802.3af)
poe-budget  standard=2   →  25.5 W  (802.3at, PoE+)
poe-budget  standard=3   →  51 W    (802.3bt type 3)
```

The device-side figure is what you have to work with; the difference from the source rating
is cable loss over 100 m.

## The order to work in

1. List every device with its **peak** current and its voltage.
2. `current-budget` against the intended supply, 20 % headroom.
3. `regulator-dissipation` on each rail — decide linear or buck.
4. `dc-wire-drop` on anything carrying real current more than a metre.
5. `capacitor-hold-up` wherever something bursts.
6. On battery: `average-current-duty` then `battery-life`, and be honest about sleep current.
7. `blueprint_check domain:"iot"` to confirm the drawing agrees with the arithmetic.
