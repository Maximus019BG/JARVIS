# Buses, levels and addressing

## Choosing one

| Bus | Wires | Devices | Speed | Use it when |
|---|---|---|---|---|
| **I²C** | 2 + GND | many, by address | 100 k / 400 k / 1 M | Sensors, displays, anything slow with few pins to spare |
| **SPI** | 3 + one CS each | many, by chip select | 1–50 MHz | Displays, SD cards, radios, anything fast |
| **UART** | 2 + GND | one pair | 9.6 k–3 M | Modems, GPS, module-to-module |
| **1-Wire** | 1 + GND | many, by ROM id | slow | DS18B20 temperature chains |
| **CAN** | 2 + GND | many | up to 1 M | Vehicles, noisy industrial runs |
| **RS-485** | 2 + GND | many | up to 10 M | Long runs, Modbus |

Rough rule: I²C when pins are scarce, SPI when speed matters, UART when it is one device
talking to one device, RS-485 or CAN when the wire leaves the enclosure.

## I²C

Two open-drain lines, SDA and SCL, pulled high by resistors. Everything is a wired-AND, so
**there must be pull-ups and there must be only one pair**.

- Size them with `engineering_calc i2c-pullup` (maximum, from rise time and bus
  capacitance) and `i2c-pullup-min` (minimum, from the sink current). 4.7 kΩ is the safe
  3.3 V default; 2.2 kΩ for a long or fast bus.
- Most breakout boards include their own pull-ups. Four boards in parallel is 1.2 kΩ,
  below the minimum, and the bus fails as you add sensors. Remove all but one set.
- Bus capacitance is roughly 10 pF per device plus 1 pF per cm of wire. Past ~400 pF the
  bus will not work at any pull-up value — use a bus extender or move to SPI.
- I²C is a **PCB-length** bus. Beyond about 30 cm treat it as unreliable.

### Common addresses

Collisions are the usual reason two sensors will not work together. `blueprint_check`
catches a declared collision; it cannot know about one you have not annotated.

| Address | Device |
|---|---|
| 0x0D | QMC5883L magnetometer |
| 0x1E | HMC5883L magnetometer |
| 0x23 / 0x5C | BH1750 light |
| 0x27 / 0x3F | LCD I²C backpack |
| 0x28 / 0x29 | BNO055 IMU |
| 0x29 | VL53L0X time-of-flight |
| 0x3C / 0x3D | SSD1306 OLED |
| 0x40 | INA219 current, PCA9685 PWM |
| 0x44 / 0x45 | SHT31 |
| 0x48–0x4B | ADS1115 ADC |
| 0x57 | MAX30102 |
| 0x58 | SGP30 air quality |
| 0x5A | CCS811 |
| 0x62 | SCD40 CO₂ |
| 0x68 / 0x69 | MPU6050 IMU, DS3231 RTC |
| 0x76 / 0x77 | BME280 / BMP280 |

Note 0x29 (VL53L0X) against 0x28/0x29 (BNO055), and 0x68 shared by MPU6050 and DS3231 —
both are real collisions people hit. Most parts have an ADDR pin or a solder jumper for the
alternate address; a VL53L0X does not, so multiple ones need their XSHUT pins sequenced.

Annotate as `U2 | mA=6, v=3.3, bus=i2c, addr=0x76`. Hex survives as written.

## SPI

Four wires: SCK, MOSI, MISO, and **one CS per device**. Faster than I²C, no addressing, no
pull-ups, but a pin per peripheral.

- Only the selected device drives MISO. A device that does not tri-state MISO properly
  breaks the bus for everyone — some SD card modules are guilty of this.
- Mode (CPOL/CPHA) is per-device. Two devices on different modes need the mode set before
  each transaction.
- Keep SCK short and away from analogue signals.
- `nrf24l01` needs a 10 µF capacitor at the module. This is the most common cause of an
  nRF24 that does not work.

## UART

**TX goes to the other end's RX.** The `uart-bus` symbol labels both ends for exactly this
reason. Both ends must agree on the baud rate, and both need a common ground.

- One pair of devices only. Two devices on one MCU UART needs a software serial port or a
  second hardware UART.
- Level matters: a 5 V module's TX into a 3.3 V RX needs a divider or a shifter.
- On a Pi, the console occupies the primary UART by default; on an ESP32, UART0 is the
  programming port. Use a different one for a modem or GPS.

## 1-Wire

One data line plus ground, with a **4.7 kΩ pull-up**. Each device has a unique 64-bit ROM
id, so many can share a line — a DS18B20 chain is the usual case.

Parasitic power (data line only, no VCC) works but is fragile at length and during
temperature conversion; run the third wire if you can.

The DHT11 and DHT22 use their own single-wire protocol which is **not** Dallas 1-Wire and
cannot share a bus.

## CAN and RS-485

Differential pairs, designed to leave the box.

- **120 Ω termination at both ends of the bus** — the two physical ends, not at each
  device. Three terminators is as broken as none.
- Daisy-chain, do not star. Keep stubs short.
- RS-485 is half duplex: the driver enable must be released or the bus is held.
- Twisted pair, shielded if the run is long or noisy, shield grounded at one end only.

## Level shifting

**3.3 V and 5 V logic do not mix.** Feeding a 3.3 V input from a 5 V output exceeds its
absolute maximum rating. It often appears to work, then fails weeks later, and the failure
looks like a firmware bug.

| Direction | What to use |
|---|---|
| 5 V out → 3.3 V in | Divider (e.g. 10 k / 20 k) for a slow signal, or a shifter |
| 3.3 V out → 5 V in | Usually nothing: most 5 V parts read 3.3 V as high — check VIH |
| Bidirectional (I²C) | BSS138 MOSFET pair, or a TXS0108E |
| Fast SPI | A dedicated buffer; a divider is too slow |

`level-shifter` in the library covers the bidirectional case. Annotate it `shift=yes` and
`blueprint_check` stops complaining about the mixed-voltage bus.

**5 V tolerant is a per-pin property**, not a per-board one. The Pi's GPIO is not 5 V
tolerant on any pin. Some STM32 pins are and some are not. Check the datasheet's pin table,
not a forum post.

### Parts that catch people out

| Part | Level trap |
|---|---|
| HC-SR04 | 5 V part, ECHO output is 5 V — shift it |
| Arduino Uno / Nano | 5 V logic throughout |
| RC522 RFID | 3.3 V only, both supply and logic |
| nRF24L01 | 3.3 V supply, but its inputs tolerate 5 V logic |
| Qwiic / STEMMA QT | Never carries 5 V — a 5 V part destroys the chain |
| Raspberry Pi GPIO | 3.3 V, not tolerant, no protection |

## Pins to avoid

**ESP32:** GPIO 6–11 are the flash and unusable. GPIO 34–39 are input-only with no
pull-ups. ADC2 does not work while Wi-Fi is on. GPIO 0, 2, 12, 15 are strapping pins —
pulling them the wrong way at boot stops the board starting.

**ESP8266:** GPIO 0, 2, 15 are strapping. GPIO 16 has no interrupt and no PWM. One ADC,
1.0 V full scale.

**Pi Pico:** GPIO 23, 24, 25, 29 are used internally on the Pico W.

**Raspberry Pi:** GPIO 2 and 3 have fixed 1.8 kΩ pull-ups on the board — they are the I²C
pins and cannot be used as general inputs with a different pull-up.

Annotate what you claim (`pin=GPIO21/GPIO22`) and `blueprint_check` will catch two devices
on the same pin. It cannot know a pin is reserved — that is what this list is for.
