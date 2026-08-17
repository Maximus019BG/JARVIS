# IoT symbol index

Every name here is a real entry in the `iot` library. Use `blueprint_symbol
action:"list" domain:"iot"` with a query for descriptions and port counts.

Qualify the name as `iot/…` where it also exists in the electrical library — `ground`,
`led`, `buzzer`, `motor-dc`, `valve-solenoid` all do.

**Board outlines are the published module dimensions and the pins are the commonly used
subset, not the whole header.** They are drawing aids: check the datasheet before cutting
an enclosure or committing a pin assignment.

## Port order

Boards report **left column top-to-bottom, then right column top-to-bottom**, matching the
pin labels drawn on the symbol. Modules report their pins top-to-bottom in the order the
labels read. Rotating a placement rotates its ports and `blueprint_symbol` returns the
transformed coordinates — never work them out yourself.

## Boards

`mcu-generic` `esp32-devkit` `esp32-c3` `esp8266` `arduino-uno` `arduino-nano` `rpi-pico`
`rpi-4` `stm32-blackpill`

| Board | Logic | Footprint | Watch for |
|---|---|---|---|
| `esp32-devkit` | 3.3 V | 28 × 52 mm | 250–500 mA on TX; ADC2 unusable while Wi-Fi is on |
| `esp32-c3` | 3.3 V | 23 × 36 mm | RISC-V single core, native USB |
| `esp8266` | 3.3 V | 25 × 34 mm | One ADC, 1.0 V full scale — not 3.3 V |
| `arduino-uno` | **5 V** | 53.4 × 68.6 mm | 5 V logic: shift before anything 3.3 V |
| `arduino-nano` | **5 V** | 18 × 45 mm | same |
| `rpi-pico` | 3.3 V | 21 × 51 mm | VSYS accepts 1.8–5.5 V; GPIO is not 5 V tolerant |
| `rpi-4` | 3.3 V | 56 × 85 mm | **Never feed 5 V into a GPIO.** Needs 3 A at 5 V |
| `stm32-blackpill` | 3.3 V | 22 × 53 mm | some pins are 5 V tolerant — check per pin |

Mixing a 5 V Arduino with a 3.3 V sensor is the single most common wiring error in this
domain. Annotate the voltages and let `blueprint_check` catch it.

**Headers and layout:** `header-2x1` `header-4x1` `header-6x1` `header-8x2` `breadboard`
`pcb-outline`

`breadboard` is a half-size board, 83 × 55 mm, with the rails marked.

## Sensors

**Environment** `dht11` `dht22` `bme280` `bmp280` `sht31` `ds18b20` `thermocouple-max6675`

`dht22` needs 2 s between reads and is a proprietary 1-Wire protocol, not Dallas 1-Wire.
`ds18b20` is real 1-Wire and needs a **4.7 kΩ pull-up on the data line**. `bme280` gives
temperature, humidity and pressure over I²C at 0x76 or 0x77.

**Light** `sensor-ldr` `bh1750` `tsl2561`

An LDR is a resistance — use it in a divider, not straight into a pin.

**Motion and distance** `pir-hcsr501` `ultrasonic-hcsr04` `tof-vl53l0x` `imu-mpu6050`
`imu-bno055` `magnetometer` `gps-neo6m` `hall-sensor` `reed-switch` `sensor-vibration`

`ultrasonic-hcsr04` runs at 5 V and its **ECHO output is 5 V** — level-shift it before a
3.3 V pin. `imu-bno055` does sensor fusion on-chip, which saves a lot of MCU work.

**Electrical** `current-acs712` `current-ina219` `current-ct-clamp`

`ina219` measures high-side current and power over I²C. A CT clamp needs a burden resistor
and a bias divider — it is not a direct connection.

**Air and water** `gas-mq2` `co2-mhz19` `co2-scd40` `air-quality-sgp30` `pm-sensor`
`soil-moisture` `rain-sensor` `flow-sensor`

MQ-series heaters draw ~150 mA continuously — they are not battery parts. Prefer
**capacitive** soil moisture sensors; resistive probes corrode within weeks.

**Other** `load-cell-hx711` `sensor-door` `sound-sensor` `camera-ov2640` `rfid-rc522`
`fingerprint-r307` `sensor-generic`

`rfid-rc522` is **3.3 V only**. `camera-ov2640` draws ~200 mA while streaming.

## Actuators and output

**Switching** `relay-1ch` `relay-2ch` `relay-4ch` `relay-ssr` `mosfet-module`

Budget ~70 mA per energised relay coil. On an opto-isolated board, keep JD-VCC separate
from VCC or the isolation is decorative. An SSR has no coil inrush but leaks when off.

**Motion** `servo` `stepper-nema17` `driver-a4988` `driver-tmc2209` `driver-l298n`
`driver-drv8833` `iot/motor-dc` `pump-peristaltic` `iot/valve-solenoid` `fan-dc`

Set an A4988's current limit with Vref **before** powering the motor. The L298N drops ~2 V
across the bridge — forgiving but inefficient; DRV8833 is better for small motors.

**Output** `iot/buzzer` `iot/led` `led-rgb` `led-strip-ws2812` `lcd-1602` `oled-ssd1306`
`tft-ili9341` `epaper-display` `7segment`

WS2812 is **60 mA per pixel at full white** — a 60-pixel strip is 3.6 A. Inject power at
both ends of a long run. E-paper takes seconds to refresh; never poll it.

## Radios

`wifi-module` `ble-module` `lora-sx1276` `lora-rfm95` `nrf24l01` `zigbee-module`
`gsm-sim800` `lte-modem` `ethernet-w5500` `rs485-max485` `can-mcp2515`
`antenna-whip` `antenna-pcb` `antenna-ufl`

`nrf24l01` is 3.3 V only and needs a **10 µF capacitor right at the module** — the single
most common cause of an nRF24 that "does not work". `gsm-sim800` pulls 2 A in a TX burst
and wants its own supply plus bulk capacitance. `rfm95` at 868 MHz in the EU is duty-cycle
limited to 1 % in most sub-bands.

Keep the ground plane clear under `antenna-pcb`.

## Power

`regulator-linear` `regulator-buck` `regulator-boost` `regulator-buckboost`
`battery-lipo` `battery-18650` `battery-coin` `battery-aa`
`charger-tp4056` `bms-1s` `solar-panel`
`usb-c` `usb-micro` `barrel-jack` `poe-splitter` `power-switch` `fuse-ptc`
`supply-rail` `iot/ground`

A single LiPo is 3.0–4.2 V, 3.7 V nominal — never discharge below 3.0 V, which is what
`bms-1s` is for. `charger-tp4056` without DW01 protection has no low-voltage cut-off.
A CR2032 cannot supply a radio's peak current, whatever its capacity says.

USB-C at 3 A needs **both** CC resistors, 5.1 kΩ to ground on each. A PTC fuse's hold
current is well below its trip current — size on hold.

## Buses and diagram furniture

`level-shifter` `i2c-bus` `spi-bus` `uart-bus` `pullup-pair` `iot/junction-dot`
`wire-label`

`connector-jst2` `connector-jst4` `connector-qwiic` `connector-grove`
`screw-terminal-2` `screw-terminal-3` `connector-rj45`

`enclosure-block` `block-generic` `block-cloud` `block-gateway`

Qwiic and STEMMA QT are the same 4-pin JST-SH: GND, 3V3, SDA, SCL. **They never carry
5 V** — putting a 5 V part on a Qwiic chain is a way to destroy a string of sensors.

The `block-*` symbols are for system diagrams rather than wiring: device → gateway → cloud.
Use them when the question is architecture and the pins do not matter yet.
