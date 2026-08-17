import type { Entity, Pt } from "../schema.ts"
import type { BlueprintSymbol, SymbolLibrary } from "./index.ts"

/**
 * Wiring-diagram and block-diagram symbols for IoT work, on the 2.54 mm grid — 0.1 inch,
 * the pitch of every pin header, DIP package and breadboard row. Boards are drawn at
 * their real footprint so a diagram doubles as a rough enclosure layout, and every pin is
 * a port, so wiring one up needs no arithmetic.
 *
 * Board outlines are the published dimensions of the common modules. They are drawing
 * aids: check the datasheet before cutting an enclosure.
 */

const U = 2.54

const line = (a: Pt, b: Pt): Entity => ({ type: "line", a, b })
const poly = (pts: Pt[], closed?: boolean): Entity => ({ type: "polyline", pts, ...(closed ? { closed } : {}) })
const box = (w: number, h: number, at: Pt = [-w / 2, -h / 2], rx?: number): Entity => ({
  type: "rect",
  at,
  w,
  h,
  ...(rx ? { rx } : {}),
})
const ring = (c: Pt, r: number): Entity => ({ type: "circle", c, r })
const arc = (c: Pt, r: number, a0: number, a1: number): Entity => ({ type: "arc", c, r, a0, a1 })
const text = (value: string, at: Pt, size = 2): Entity => ({ type: "text", at, text: value, size })
const pad = (c: Pt): Entity => ({ type: "circle", c, r: 0.8 })

/**
 * A board: outline, name, and a pin down each side on the 2.54 grid. Pins are laid out
 * top to bottom, left column first, which is the order `ports` reports them in — so port
 * `i` is `pins[i]`, and the label next to it says which signal it is.
 */
function board(options: {
  describe: string
  w: number
  h: number
  name: string
  left: string[]
  right: string[]
  extra?: Entity[]
}): BlueprintSymbol {
  const { w, h, name, left, right } = options
  const column = (labels: string[], x: number, anchor: number, align: "left" | "right"): { pins: Pt[]; marks: Entity[] } => {
    const pins: Pt[] = []
    const marks: Entity[] = []
    const top = -((labels.length - 1) * U) / 2
    labels.forEach((label, i) => {
      const y = top + i * U
      pins.push([x, y])
      marks.push(pad([anchor, y]))
      marks.push(line([anchor, y], [x, y]))
      marks.push(text(label, [align === "left" ? anchor + 1.6 : anchor - 1.6 - label.length * 1.2, y + 0.7], 1.8))
    })
    return { pins, marks }
  }
  const a = column(left, -w / 2 - 3 * U, -w / 2 + 1.6, "left")
  const b = column(right, w / 2 + 3 * U, w / 2 - 1.6, "right")
  return {
    describe: options.describe,
    entities: [
      box(w, h, [-w / 2, -h / 2], 1.5),
      text(name, [-name.length * 0.85, 0.9], 2.6),
      ...a.marks,
      ...b.marks,
      ...(options.extra ?? []),
    ],
    ports: [...a.pins, ...b.pins],
  }
}

/**
 * A block with pins on one side: the shape most sensors and modules take on a wiring
 * diagram, where the internals do not matter and the connections do.
 */
function module(describe: string, name: string, pins: string[], options: { w?: number; standard?: string; body?: Entity[] } = {}): BlueprintSymbol {
  const w = options.w ?? 20.32
  const h = Math.max(4, pins.length + 1) * U
  const top = -((pins.length - 1) * U) / 2
  const ports: Pt[] = []
  const marks: Entity[] = []
  pins.forEach((label, i) => {
    const y = top + i * U
    ports.push([w / 2 + 3 * U, y])
    marks.push(line([w / 2, y], [w / 2 + 3 * U, y]))
    marks.push(pad([w / 2 + 3 * U, y]))
    marks.push(text(label, [w / 2 - 1.4 - label.length * 1.1, y + 0.7], 1.8))
  })
  return {
    describe,
    standard: options.standard,
    entities: [box(w, h, [-w / 2, -h / 2], 1.5), text(name, [-name.length * 0.8, -h / 2 + 3], 2.4), ...(options.body ?? []), ...marks],
    ports,
  }
}

/** A two-terminal part drawn inline on a wiring diagram. */
const inline = (describe: string, body: Entity[], span = 4 * U): BlueprintSymbol => ({
  describe,
  entities: [...body, line([-span, 0], [-span / 2, 0]), line([span / 2, 0], [span, 0])],
  ports: [
    [-span, 0],
    [span, 0],
  ],
})

// ─── boards and headers ──────────────────────────────────────────────────────────────

const boards: SymbolLibrary = {
  "mcu-generic": board({
    describe: "Generic microcontroller block. Relabel the pins for the part you are using",
    w: 25.4,
    h: 10 * U,
    name: "MCU",
    left: ["VCC", "GND", "SDA", "SCL"],
    right: ["IO0", "IO1", "IO2", "IO3"],
  }),
  "esp32-devkit": board({
    describe: "ESP32 DevKitC, 3.3 V logic, 52 × 28 mm. Pins shown are the commonly used subset",
    w: 28,
    h: 52,
    name: "ESP32",
    left: ["3V3", "GND", "GPIO21 SDA", "GPIO22 SCL", "GPIO4", "GPIO5", "GPIO18", "GPIO19"],
    right: ["VIN 5V", "GND", "GPIO32", "GPIO33", "GPIO25", "GPIO26", "GPIO27", "GPIO14"],
  }),
  "esp32-c3": board({
    describe: "ESP32-C3 mini board, 3.3 V logic. RISC-V, single core, native USB",
    w: 23,
    h: 36,
    name: "ESP32-C3",
    left: ["3V3", "GND", "GPIO8 SDA", "GPIO9 SCL"],
    right: ["5V", "GND", "GPIO2", "GPIO3"],
  }),
  esp8266: board({
    describe: "ESP8266 / Wemos D1 mini, 3.3 V logic, 34 × 25 mm. Only one ADC, 1.0 V full scale",
    w: 25,
    h: 34,
    name: "D1 mini",
    left: ["3V3", "GND", "D1 SCL", "D2 SDA"],
    right: ["5V", "A0", "D5 SCK", "D7 MOSI"],
  }),
  "arduino-uno": board({
    describe: "Arduino Uno R3, 5 V logic, 68.6 × 53.4 mm",
    w: 53.4,
    h: 68.6,
    name: "Uno",
    left: ["5V", "3V3", "GND", "VIN", "A0", "A4 SDA", "A5 SCL"],
    right: ["D2", "D3 PWM", "D9 PWM", "D10 SS", "D11 MOSI", "D12 MISO", "D13 SCK"],
  }),
  "arduino-nano": board({
    describe: "Arduino Nano, 5 V logic, 45 × 18 mm",
    w: 18,
    h: 45,
    name: "Nano",
    left: ["5V", "GND", "VIN", "A4 SDA", "A5 SCL"],
    right: ["D2", "D3 PWM", "D11 MOSI", "D12 MISO", "D13 SCK"],
  }),
  "rpi-pico": board({
    describe: "Raspberry Pi Pico / Pico W, 3.3 V logic, 51 × 21 mm",
    w: 21,
    h: 51,
    name: "Pico",
    left: ["3V3", "GND", "GP0 UART TX", "GP1 UART RX", "GP4 SDA", "GP5 SCL"],
    right: ["VSYS 5V", "GND", "GP16 MISO", "GP17 CS", "GP18 SCK", "GP19 MOSI"],
  }),
  "rpi-4": board({
    describe: "Raspberry Pi 4B, 3.3 V GPIO logic, 85 × 56 mm. Never feed 5 V into a GPIO",
    w: 56,
    h: 85,
    name: "Pi 4B",
    left: ["3V3", "GND", "GPIO2 SDA", "GPIO3 SCL", "GPIO14 TXD", "GPIO15 RXD"],
    right: ["5V", "GND", "GPIO10 MOSI", "GPIO9 MISO", "GPIO11 SCK", "GPIO8 CE0"],
  }),
  "stm32-blackpill": board({
    describe: "STM32F411 Black Pill, 3.3 V logic, 53 × 22 mm",
    w: 22,
    h: 53,
    name: "STM32",
    left: ["3V3", "GND", "PB6 SCL", "PB7 SDA"],
    right: ["5V", "GND", "PA5 SCK", "PA7 MOSI"],
  }),
  "header-2x1": {
    describe: "2-pin header on 2.54 pitch",
    entities: [box(2 * U, U + 1.6), pad([-U / 2, 0]), pad([U / 2, 0])],
    ports: [
      [-U / 2, 0],
      [U / 2, 0],
    ],
  },
  "header-4x1": {
    describe: "4-pin header on 2.54 pitch — the usual I²C / Qwiic breakout",
    entities: [box(4 * U, U + 1.6), ...[-1.5, -0.5, 0.5, 1.5].map((i) => pad([i * U, 0]))],
    ports: [
      [-1.5 * U, 0],
      [-0.5 * U, 0],
      [0.5 * U, 0],
      [1.5 * U, 0],
    ],
  },
  "header-6x1": {
    describe: "6-pin header on 2.54 pitch (FTDI / programming)",
    entities: [box(6 * U, U + 1.6), ...[-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((i) => pad([i * U, 0]))],
    ports: [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((i) => [i * U, 0] as Pt),
  },
  "header-8x2": {
    describe: "8×2 header on 2.54 pitch",
    entities: [
      box(8 * U, 2 * U),
      ...[-3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5].flatMap((i) => [pad([i * U, -U / 2]), pad([i * U, U / 2])]),
    ],
    ports: [-3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5].flatMap((i) => [[i * U, -U / 2] as Pt, [i * U, U / 2] as Pt]),
  },
  breadboard: {
    describe: "Half-size breadboard, 30 columns on 2.54 pitch, 83 × 55 mm",
    entities: [
      box(83, 55, [-41.5, -27.5], 2),
      line([-41.5, -7.62], [41.5, -7.62]),
      line([-41.5, 7.62], [41.5, 7.62]),
      line([-41.5, -22.86], [41.5, -22.86]),
      line([-41.5, 22.86], [41.5, 22.86]),
      text("+", [-39, -19], 3),
      text("−", [-39, 26], 3),
    ],
  },
  "pcb-outline": {
    describe: "Generic PCB outline, 50 × 40 mm with 3.2 mm mounting holes",
    entities: [box(50, 40, [-25, -20], 2), ...[[-21, -16], [21, -16], [-21, 16], [21, 16]].map((c) => ring(c as Pt, 1.6))],
  },
}

// ─── sensors ─────────────────────────────────────────────────────────────────────────

const sensors: SymbolLibrary = {
  "sensor-generic": module("Generic sensor block. Relabel for the part", "SENSOR", ["VCC", "GND", "OUT"]),
  dht22: module("DHT22 / AM2302 temperature and humidity, 3.3–5 V, 1-Wire proprietary bus, 2 s minimum interval", "DHT22", ["VCC", "DATA", "GND"]),
  dht11: module("DHT11 temperature and humidity, 3.3–5 V. Lower accuracy than the DHT22", "DHT11", ["VCC", "DATA", "GND"]),
  bme280: module("BME280 temperature, humidity and pressure. I²C 0x76/0x77 or SPI, 3.3 V", "BME280", ["VCC", "GND", "SCL", "SDA"]),
  bmp280: module("BMP280 temperature and pressure. I²C 0x76/0x77, 3.3 V", "BMP280", ["VCC", "GND", "SCL", "SDA"]),
  sht31: module("SHT31 temperature and humidity, I²C 0x44/0x45, 3.3 V", "SHT31", ["VCC", "GND", "SCL", "SDA"]),
  ds18b20: module("DS18B20 temperature probe, 1-Wire, needs a 4.7 kΩ pull-up on DATA", "DS18B20", ["VCC", "DATA", "GND"], { w: 17.78 }),
  "thermocouple-max6675": module("MAX6675 K-type thermocouple interface, SPI read-only", "MAX6675", ["VCC", "GND", "SCK", "CS", "SO"]),
  "sensor-ldr": inline("Light-dependent resistor. Use in a divider with a fixed resistor", [
    box(4 * U, 3.81),
    line([-8, -8], [-5, -5.2]),
    line([-4, -8], [-1, -5.2]),
  ]),
  bh1750: module("BH1750 ambient light, lux output, I²C 0x23/0x5C", "BH1750", ["VCC", "GND", "SCL", "SDA", "ADDR"]),
  tsl2561: module("TSL2561 light sensor with IR compensation, I²C", "TSL2561", ["VCC", "GND", "SCL", "SDA"]),
  "pir-hcsr501": module("HC-SR501 PIR motion sensor, 5 V supply, 3.3 V output. 2–3 s warm-up", "HC-SR501", ["VCC", "OUT", "GND"]),
  "ultrasonic-hcsr04": module("HC-SR04 ultrasonic range, 5 V. Echo is 5 V — level-shift it for a 3.3 V MCU", "HC-SR04", ["VCC", "TRIG", "ECHO", "GND"], { w: 45 }),
  "tof-vl53l0x": module("VL53L0X time-of-flight range, up to 2 m, I²C 0x29", "VL53L0X", ["VCC", "GND", "SCL", "SDA", "XSHUT"]),
  "imu-mpu6050": module("MPU-6050 6-axis accelerometer and gyro, I²C 0x68/0x69", "MPU6050", ["VCC", "GND", "SCL", "SDA", "INT"]),
  "imu-bno055": module("BNO055 9-axis IMU with onboard fusion, I²C 0x28/0x29", "BNO055", ["VCC", "GND", "SCL", "SDA"]),
  magnetometer: module("QMC5883L / HMC5883L 3-axis magnetometer, I²C", "QMC5883L", ["VCC", "GND", "SCL", "SDA"]),
  "gps-neo6m": module("NEO-6M GPS receiver, UART at 9600 baud", "NEO-6M", ["VCC", "RX", "TX", "GND"]),
  "hall-sensor": module("Hall effect sensor, digital output", "HALL", ["VCC", "OUT", "GND"], { w: 15.24 }),
  "reed-switch": inline("Reed switch: closes in a magnetic field", [line([-5, 0], [-1, 0]), line([1, 0], [5, 0]), arc([0, 0], 5.4, 180, 360), arc([0, 0], 5.4, 0, 180)]),
  "current-acs712": module("ACS712 hall-effect current sensor, analogue out, 5 V. 5 A / 20 A / 30 A variants", "ACS712", ["VCC", "OUT", "GND"], { w: 22.86 }),
  "current-ina219": module("INA219 high-side current and power monitor, I²C 0x40", "INA219", ["VCC", "GND", "SCL", "SDA", "VIN+", "VIN−"]),
  "current-ct-clamp": module("Split-core CT clamp, e.g. SCT-013. Needs a burden resistor and a bias divider", "CT", ["SIG", "GND"], { w: 22.86 }),
  "gas-mq2": module("MQ-2 combustible gas sensor, 5 V, heater draws ~150 mA continuously", "MQ-2", ["VCC", "GND", "AOUT", "DOUT"]),
  "co2-mhz19": module("MH-Z19 NDIR CO₂ sensor, UART or PWM, 5 V, ~150 mA peak", "MH-Z19", ["VCC", "GND", "RX", "TX", "PWM"]),
  "co2-scd40": module("SCD40 photoacoustic CO₂ sensor, I²C 0x62, 3.3 V", "SCD40", ["VCC", "GND", "SCL", "SDA"]),
  "air-quality-sgp30": module("SGP30 VOC / eCO₂ sensor, I²C 0x58", "SGP30", ["VCC", "GND", "SCL", "SDA"]),
  "pm-sensor": module("PMS5003 particulate matter sensor, UART, 5 V, ~100 mA with the fan running", "PMS5003", ["VCC", "GND", "RX", "TX", "SET"]),
  "soil-moisture": module("Capacitive soil moisture sensor, analogue out. Prefer capacitive over resistive — resistive probes corrode", "SOIL", ["VCC", "GND", "AOUT"]),
  "rain-sensor": module("Rain / water level sensor, analogue and digital out", "RAIN", ["VCC", "GND", "AOUT", "DOUT"]),
  "flow-sensor": module("Hall-effect flow meter, pulse output. Count pulses per litre from the datasheet", "FLOW", ["VCC", "SIG", "GND"]),
  "load-cell-hx711": module("HX711 24-bit load-cell amplifier. E+/E− excite the bridge, A+/A− read it", "HX711", ["VCC", "GND", "DT", "SCK", "E+", "E−", "A+", "A−"]),
  "sensor-door": module("Magnetic door / window contact, dry contact", "DOOR", ["COM", "NO"], { w: 17.78 }),
  "sensor-vibration": module("SW-420 vibration sensor, digital out", "SW-420", ["VCC", "GND", "DOUT"]),
  "sound-sensor": module("Sound level sensor / electret module, analogue and digital out", "SOUND", ["VCC", "GND", "AOUT", "DOUT"]),
  "camera-ov2640": module("OV2640 camera module for ESP32-CAM. Draws ~200 mA while streaming", "OV2640", ["3V3", "GND", "SDA", "SCL", "DATA"]),
  "rfid-rc522": module("MFRC522 13.56 MHz RFID reader, SPI, 3.3 V only", "RC522", ["3V3", "GND", "SCK", "MOSI", "MISO", "SDA", "RST"]),
  "fingerprint-r307": module("R307 optical fingerprint sensor, UART, 3.3–5 V", "R307", ["VCC", "GND", "TX", "RX"]),
}

// ─── actuators and output ────────────────────────────────────────────────────────────

const actuators: SymbolLibrary = {
  "relay-1ch": module("Single-channel relay module. Opto-isolated boards need JD-VCC separated from VCC", "RELAY", ["VCC", "GND", "IN", "COM", "NO", "NC"]),
  "relay-2ch": module("Two-channel relay module", "RELAY ×2", ["VCC", "GND", "IN1", "IN2", "COM1", "COM2"]),
  "relay-4ch": module("Four-channel relay module. Budget ~70 mA per energised coil", "RELAY ×4", ["VCC", "GND", "IN1", "IN2", "IN3", "IN4"]),
  "relay-ssr": module("Solid-state relay. No coil inrush, but check the leakage current when off", "SSR", ["IN+", "IN−", "L-IN", "L-OUT"]),
  "mosfet-module": module("Logic-level MOSFET switch module for a DC load", "MOSFET", ["VIN", "GND", "SIG", "OUT+", "OUT−"]),
  servo: {
    describe: "Hobby servo. Stall current can be 1 A on a 9 g servo — never feed it from the MCU's regulator",
    entities: [box(22.86, 12.7, [-11.43, -6.35], 1), ring([6, 0], 4.5), text("SERVO", [-9.5, 1], 2.2), ...[-1, 0, 1].map((i) => line([-11.43, i * U], [-11.43 - 3 * U, i * U])), ...[-1, 0, 1].map((i) => pad([-11.43 - 3 * U, i * U]))],
    ports: [
      [-11.43 - 3 * U, -U],
      [-11.43 - 3 * U, 0],
      [-11.43 - 3 * U, U],
    ],
  },
  "stepper-nema17": module("NEMA 17 stepper motor, bipolar, 42 mm frame", "NEMA17", ["A+", "A−", "B+", "B−"], { w: 42 }),
  "driver-a4988": module("A4988 stepper driver. Set the current limit with Vref before powering the motor", "A4988", ["VMOT", "GND", "VDD", "STEP", "DIR", "EN", "1A", "1B", "2A", "2B"]),
  "driver-tmc2209": module("TMC2209 silent stepper driver, UART configurable", "TMC2209", ["VMOT", "GND", "VDD", "STEP", "DIR", "EN", "UART"]),
  "driver-l298n": module("L298N dual H-bridge. Drops ~2 V across the bridge — inefficient but forgiving", "L298N", ["12V", "GND", "5V", "IN1", "IN2", "IN3", "IN4", "OUT1", "OUT2"]),
  "driver-drv8833": module("DRV8833 dual H-bridge, low dropout, 3.3 V logic", "DRV8833", ["VM", "GND", "AIN1", "AIN2", "AOUT1", "AOUT2"]),
  "motor-dc": {
    describe: "DC motor. Fit a flyback diode across it if it is switched by a transistor",
    entities: [ring([0, 0], 7.62), text("M", [-1.6, 1.2], 4), line([-7.62, 0], [-7.62 - 3 * U, 0]), line([7.62, 0], [7.62 + 3 * U, 0])],
    ports: [
      [-7.62 - 3 * U, 0],
      [7.62 + 3 * U, 0],
    ],
  },
  "pump-peristaltic": module("Peristaltic dosing pump, 12 V DC", "PUMP", ["V+", "V−"], { w: 22.86 }),
  "valve-solenoid": module("Solenoid valve, 12 V. Inductive — needs a flyback diode", "VALVE", ["V+", "V−"], { w: 22.86 }),
  "fan-dc": {
    describe: "DC fan, 4-wire PWM type. Tacho is open-collector and needs a pull-up",
    entities: [box(25.4, 25.4, [-12.7, -12.7], 2), ring([0, 0], 10), ...[0, 120, 240].map((a) => arc([0, 0], 8, a, a + 90)), ...[-1.5, -0.5, 0.5, 1.5].map((i) => pad([i * U, 15]))],
    ports: [-1.5, -0.5, 0.5, 1.5].map((i) => [i * U, 15] as Pt),
  },
  buzzer: {
    describe: "Active buzzer. A passive one needs a PWM tone instead of a level",
    entities: [ring([0, 0], 6.35), arc([0, 0], 3, 90, 270), line([-3.4, -6.35 + 1], [-3.4, 6.35 - 1]), line([-6.35, 0], [-6.35 - 2 * U, 0]), line([6.35, 0], [6.35 + 2 * U, 0])],
    ports: [
      [-6.35 - 2 * U, 0],
      [6.35 + 2 * U, 0],
    ],
  },
  led: inline("LED. Always with a series resistor — see the led-resistor formula in engineering_calc", [
    poly([[-2.2, -2.6], [2.2, 0], [-2.2, 2.6]], true),
    line([2.2, -2.8], [2.2, 2.8]),
    line([0, -4], [2.4, -6.8]),
    line([2.6, -3.4], [5, -6.2]),
  ]),
  "led-rgb": module("Common-cathode RGB LED", "RGB", ["R", "G", "B", "GND"], { w: 12.7 }),
  "led-strip-ws2812": module("WS2812B / NeoPixel strip. 60 mA per pixel at full white — budget the supply, and inject power on long runs", "WS2812B", ["5V", "DIN", "GND"], { w: 30 }),
  "lcd-1602": {
    describe: "16×2 character LCD with an I²C backpack, 0x27 or 0x3F. 5 V for the backlight",
    entities: [box(80, 36, [-40, -18], 1.5), box(64.5, 16, [-32.25, -8]), text("LCD 16×2", [-11, 1], 3), ...[-1.5, -0.5, 0.5, 1.5].map((i) => pad([-40 - 3 * U, i * U]))],
    ports: [-1.5, -0.5, 0.5, 1.5].map((i) => [-40 - 3 * U, i * U] as Pt),
  },
  "oled-ssd1306": module("SSD1306 OLED, 128×64, I²C 0x3C, 3.3 V", "SSD1306", ["VCC", "GND", "SCL", "SDA"], { w: 27 }),
  "tft-ili9341": module("ILI9341 TFT, 320×240, SPI, 3.3 V logic", "ILI9341", ["VCC", "GND", "SCK", "MOSI", "CS", "DC", "RST"], { w: 50 }),
  "epaper-display": module("E-paper display, SPI. Refresh takes seconds — do not poll it", "E-PAPER", ["VCC", "GND", "SCK", "MOSI", "CS", "DC", "BUSY"], { w: 50 }),
  "7segment": module("7-segment display driver, TM1637", "TM1637", ["VCC", "GND", "CLK", "DIO"], { w: 30 }),
}

// ─── radios and connectivity ─────────────────────────────────────────────────────────

const radios: SymbolLibrary = {
  "wifi-module": module("Wi-Fi module. Peak TX current is 250–500 mA on ESP parts — size the regulator for the peak, not the average", "WiFi", ["VCC", "GND", "TX", "RX"]),
  "ble-module": module("Bluetooth LE module, UART", "BLE", ["VCC", "GND", "TX", "RX"]),
  "lora-sx1276": module("SX1276 LoRa radio, SPI, 3.3 V. ~120 mA on TX at +20 dBm", "SX1276", ["3V3", "GND", "SCK", "MOSI", "MISO", "NSS", "RST", "DIO0"]),
  "lora-rfm95": module("RFM95 LoRa module, 868 MHz in EU. Duty cycle limited to 1 % in most sub-bands", "RFM95", ["3V3", "GND", "SCK", "MOSI", "MISO", "NSS", "DIO0"]),
  nrf24l01: module("nRF24L01+ 2.4 GHz radio, SPI, 3.3 V only. Needs a 10 µF decoupling capacitor at the module", "nRF24L01", ["3V3", "GND", "CE", "CSN", "SCK", "MOSI", "MISO"]),
  "zigbee-module": module("Zigbee / 802.15.4 module, UART", "ZIGBEE", ["VCC", "GND", "TX", "RX"]),
  "gsm-sim800": module("SIM800L GSM modem. 2 A peak on TX burst — needs a bulk capacitor and its own supply", "SIM800L", ["VCC 4V", "GND", "TX", "RX", "RST"]),
  "lte-modem": module("LTE Cat-M / NB-IoT modem, UART", "LTE", ["VCC", "GND", "TX", "RX", "PWRKEY"]),
  "ethernet-w5500": module("W5500 Ethernet controller, SPI, 3.3 V", "W5500", ["3V3", "GND", "SCK", "MOSI", "MISO", "CS", "INT"]),
  "rs485-max485": module("MAX485 RS-485 transceiver. Terminate the bus with 120 Ω at both ends", "MAX485", ["VCC", "GND", "RO", "RE", "DE", "DI", "A", "B"]),
  "can-mcp2515": module("MCP2515 CAN controller with a TJA1050 transceiver, SPI", "MCP2515", ["VCC", "GND", "SCK", "MOSI", "MISO", "CS", "INT", "CANH", "CANL"]),
  "antenna-whip": {
    describe: "Whip / external antenna",
    entities: [line([0, 0], [0, -5.08]), line([-4.4, -8.8], [0, -5.08]), line([4.4, -8.8], [0, -5.08])],
    ports: [[0, 0]],
  },
  "antenna-pcb": {
    describe: "PCB trace antenna. Keep the ground plane clear underneath it",
    entities: [poly([[0, 0], [0, -4], [4, -4], [4, -8], [8, -8], [8, -12]]), line([0, 0], [0, 3 * U])],
    ports: [[0, 3 * U]],
  },
  "antenna-ufl": {
    describe: "U.FL / IPEX connector for an external antenna",
    entities: [ring([0, 0], 3), ring([0, 0], 1.2), line([0, 3], [0, 3 + 2 * U])],
    ports: [[0, 3 + 2 * U]],
  },
}

// ─── power ───────────────────────────────────────────────────────────────────────────

const power: SymbolLibrary = {
  "regulator-linear": module("Linear regulator, e.g. AMS1117. Dissipates (Vin − Vout) × I as heat — check it with the regulator-dissipation formula", "LDO", ["VIN", "GND", "VOUT"], { w: 20.32 }),
  "regulator-buck": module("Buck (step-down) converter. 85–95 % efficient; prefer it over an LDO above ~200 mA", "BUCK", ["VIN", "GND", "VOUT"], { w: 20.32 }),
  "regulator-boost": module("Boost (step-up) converter. Input current is higher than output current", "BOOST", ["VIN", "GND", "VOUT"], { w: 20.32 }),
  "regulator-buckboost": module("Buck-boost converter, for a battery that crosses the output voltage", "BUCK-BOOST", ["VIN", "GND", "VOUT"], { w: 22.86 }),
  "battery-lipo": {
    describe: "Single-cell LiPo, 3.7 V nominal, 3.0–4.2 V range. Never discharge below 3.0 V",
    entities: [box(30, 20, [-15, -10], 1.5), text("LiPo 3.7V", [-9.5, 1], 2.4), line([-15, -5], [-15 - 3 * U, -5]), line([-15, 5], [-15 - 3 * U, 5]), text("+", [-15 - 3 * U, -6.5], 2.4)],
    ports: [
      [-15 - 3 * U, -5],
      [-15 - 3 * U, 5],
    ],
  },
  "battery-18650": {
    describe: "18650 Li-ion cell, 3.7 V nominal, typically 2500–3500 mAh",
    entities: [box(65, 18, [-32.5, -9], 4), text("18650", [-6, 1], 2.6), line([32.5, 0], [32.5 + 3 * U, 0]), line([-32.5, 0], [-32.5 - 3 * U, 0]), text("+", [33, -2], 2.4)],
    ports: [
      [32.5 + 3 * U, 0],
      [-32.5 - 3 * U, 0],
    ],
  },
  "battery-coin": {
    describe: "CR2032 coin cell, 3 V, ~220 mAh. Peak current is limited — do not run a radio directly from one",
    entities: [ring([0, 0], 10), text("CR2032", [-6.5, 1], 2.2), line([0, -10], [0, -10 - 2 * U]), line([0, 10], [0, 10 + 2 * U])],
    ports: [
      [0, -10 - 2 * U],
      [0, 10 + 2 * U],
    ],
  },
  "battery-aa": {
    describe: "AA cell holder, 1.5 V per cell (1.2 V for NiMH)",
    entities: [box(56, 16, [-28, -8], 2), text("AA", [-2.5, 1], 2.6), line([28, 0], [28 + 3 * U, 0]), line([-28, 0], [-28 - 3 * U, 0])],
    ports: [
      [28 + 3 * U, 0],
      [-28 - 3 * U, 0],
    ],
  },
  "charger-tp4056": module("TP4056 single-cell Li-ion charger. Use the variant with DW01 protection, or add protection separately", "TP4056", ["IN+", "IN−", "B+", "B−", "OUT+", "OUT−"]),
  "bms-1s": module("1S battery protection board: over-discharge, over-charge and short-circuit cut-off", "BMS 1S", ["B+", "B−", "P+", "P−"]),
  "solar-panel": {
    describe: "Solar panel. Rated at 1000 W/m² — derate hard for real light and angle",
    entities: [box(40, 24, [-20, -12]), ...[-10, 0, 10].map((x) => line([x, -12], [x, 12])), line([-20, 0], [-20 - 3 * U, 0]), line([20, 0], [20 + 3 * U, 0])],
    ports: [
      [-20 - 3 * U, 0],
      [20 + 3 * U, 0],
    ],
  },
  "usb-c": {
    describe: "USB-C connector. 5 V at 3 A needs both CC resistors — 5.1 kΩ to GND on each",
    entities: [box(9, 3.2, [-4.5, -1.6], 1.6), ...[-1.5, -0.5, 0.5, 1.5].map((i) => pad([i * U, 5]))],
    ports: [-1.5, -0.5, 0.5, 1.5].map((i) => [i * U, 5] as Pt),
  },
  "usb-micro": {
    describe: "Micro-USB connector, 5 V",
    entities: [box(8, 3, [-4, -1.5]), ...[-1, 0, 1].map((i) => pad([i * U, 5]))],
    ports: [-1, 0, 1].map((i) => [i * U, 5] as Pt),
  },
  "barrel-jack": {
    describe: "DC barrel jack, 5.5 × 2.1 mm. Centre positive is the usual convention — confirm it",
    entities: [box(14, 9, [-7, -4.5], 1), ring([-3, 0], 2.2), line([7, -2.54], [7 + 3 * U, -2.54]), line([7, 2.54], [7 + 3 * U, 2.54])],
    ports: [
      [7 + 3 * U, -2.54],
      [7 + 3 * U, 2.54],
    ],
  },
  "poe-splitter": module("PoE splitter, 802.3af/at. 12.95 W available at the powered device on af", "PoE", ["RJ45", "GND", "VOUT", "DATA"], { w: 25.4 }),
  "power-switch": inline("Power switch, SPST", [line([-5, 0], [-1, 0]), line([1, 0], [5, 0]), line([-1, 0], [4.5, -3.6])]),
  "fuse-ptc": inline("Resettable PTC fuse. Hold current is well below the trip current — size on hold", [
    box(4 * U, 3.81),
    text("PTC", [-3.4, 1], 2),
  ]),
  "supply-rail": {
    describe: "Supply rail marker. Label with the voltage",
    entities: [line([0, 0], [0, -4]), line([-4, -4], [4, -4]), text("+5V", [-4, -5.6], 2.4)],
    ports: [[0, 0]],
  },
  ground: {
    describe: "Ground / 0 V",
    entities: [line([0, 0], [0, 3]), line([-4, 3], [4, 3]), line([-2.5, 4.8], [2.5, 4.8]), line([-1, 6.6], [1, 6.6])],
    ports: [[0, 0]],
  },
}

// ─── bus and interface furniture ─────────────────────────────────────────────────────

const buses: SymbolLibrary = {
  "level-shifter": module("Bidirectional level shifter, e.g. TXS0108E or a BSS138 pair. Required between 5 V and 3.3 V logic", "LEVEL SHIFT", ["LV", "HV", "GND", "LV1", "HV1", "LV2", "HV2"], { w: 25.4 }),
  "i2c-bus": {
    describe: "I²C bus: SDA and SCL with their pull-ups. 4.7 kΩ is right for most 3.3 V buses under 400 kHz",
    entities: [
      line([-20, -U], [20, -U]),
      line([-20, U], [20, U]),
      text("SDA", [-26, -U + 0.7], 2),
      text("SCL", [-26, U + 0.7], 2),
      box(3.81, 4 * U, [-2, -6 * U]),
      line([0, -6 * U], [0, -8 * U]),
      line([0, -2 * U], [0, -U]),
      box(3.81, 4 * U, [4, -6 * U]),
      line([6, -6 * U], [6, -8 * U]),
      line([6, -2 * U], [6, U]),
      text("4k7", [10, -4 * U], 2),
    ],
    ports: [
      [-20, -U],
      [-20, U],
      [20, -U],
      [20, U],
      [0, -8 * U],
    ],
  },
  "spi-bus": {
    describe: "SPI bus: SCK, MOSI, MISO and a chip select per device",
    entities: [
      ...[0, 1, 2, 3].map((i) => line([-20, (i - 1.5) * U], [20, (i - 1.5) * U])),
      ...["SCK", "MOSI", "MISO", "CS"].map((label, i) => text(label, [-29, (i - 1.5) * U + 0.7], 2)),
    ],
    ports: [0, 1, 2, 3].flatMap((i) => [[-20, (i - 1.5) * U] as Pt, [20, (i - 1.5) * U] as Pt]),
  },
  "uart-bus": {
    describe: "UART link. TX goes to the other end's RX — crossing them is the classic mistake",
    entities: [line([-20, -U], [20, -U]), line([-20, U], [20, U]), text("TX", [-27, -U + 0.7], 2), text("RX", [-27, U + 0.7], 2), text("RX", [22, -U + 0.7], 2), text("TX", [22, U + 0.7], 2)],
    ports: [
      [-20, -U],
      [-20, U],
      [20, -U],
      [20, U],
    ],
  },
  "pullup-pair": {
    describe: "A pull-up resistor pair for an I²C bus",
    entities: [box(3.81, 4 * U, [-2, -5.08]), line([0, -5.08], [0, -5 * U]), line([0, 5.08], [0, 4 * U]), box(3.81, 4 * U, [6, -5.08]), line([8, -5.08], [8, -5 * U]), line([8, 5.08], [8, 4 * U])],
    ports: [
      [0, -5 * U],
      [0, 4 * U],
      [8, -5 * U],
      [8, 4 * U],
    ],
  },
  "junction-dot": {
    describe: "Wire junction. Place one wherever wires meet and connect",
    entities: [{ type: "circle", c: [0, 0], r: 0.8, width: 1.2 }],
    ports: [[0, 0]],
  },
  "wire-label": {
    describe: "Wire label flag. Edit the text to the net name",
    entities: [line([0, 0], [0, -4]), poly([[0, -4], [14, -4], [16, -6.5], [14, -9], [0, -9]], true), text("NET", [2, -5.6], 2.4)],
    ports: [[0, 0]],
  },
  "connector-jst2": {
    describe: "JST-PH 2-pin connector, 2.0 mm pitch",
    entities: [box(2 * 2, 4, [-2, -2], 0.5), pad([-1, 0]), pad([1, 0])],
    ports: [
      [-1, 0],
      [1, 0],
    ],
  },
  "connector-jst4": {
    describe: "JST-PH 4-pin connector, 2.0 mm pitch",
    entities: [box(8, 4, [-4, -2], 0.5), ...[-3, -1, 1, 3].map((x) => pad([x, 0]))],
    ports: [-3, -1, 1, 3].map((x) => [x, 0] as Pt),
  },
  "connector-qwiic": {
    describe: "Qwiic / STEMMA QT 4-pin JST-SH: GND, 3V3, SDA, SCL. Never carries 5 V",
    entities: [box(6, 4, [-3, -2], 0.5), ...[-2.25, -0.75, 0.75, 2.25].map((x) => pad([x, 0])), text("Qwiic", [-5, 5], 2)],
    ports: [-2.25, -0.75, 0.75, 2.25].map((x) => [x, 0] as Pt),
  },
  "connector-grove": {
    describe: "Grove 4-pin connector, 2.0 mm pitch: GND, VCC, SIG1, SIG2",
    entities: [box(8, 5, [-4, -2.5], 0.5), ...[-3, -1, 1, 3].map((x) => pad([x, 0])), text("Grove", [-6, 6], 2)],
    ports: [-3, -1, 1, 3].map((x) => [x, 0] as Pt),
  },
  "screw-terminal-2": {
    describe: "2-way screw terminal, 5.08 mm pitch",
    entities: [box(2 * 5.08, 8, [-5.08, -4], 0.6), ...[-2.54, 2.54].map((x) => ring([x, 0], 1.6)), ...[-2.54, 2.54].map((x) => line([x - 1.1, -1.1], [x + 1.1, 1.1]))],
    ports: [
      [-2.54, 0],
      [2.54, 0],
    ],
  },
  "screw-terminal-3": {
    describe: "3-way screw terminal, 5.08 mm pitch",
    entities: [box(3 * 5.08, 8, [-7.62, -4], 0.6), ...[-5.08, 0, 5.08].map((x) => ring([x, 0], 1.6))],
    ports: [
      [-5.08, 0],
      [0, 0],
      [5.08, 0],
    ],
  },
  "connector-rj45": {
    describe: "RJ45 Ethernet jack",
    entities: [box(16, 14, [-8, -7], 1), box(8, 4, [-4, -7]), text("RJ45", [-4.5, 3], 2.4)],
    ports: [[0, 7]],
  },
  "enclosure-block": {
    describe: "Enclosure boundary for a block diagram. Scale to what it contains",
    entities: [{ type: "rect", at: [-50, -35], w: 100, h: 70, rx: 3, dash: "dashed" }],
  },
  "block-generic": {
    describe: "Generic labelled block for a block diagram. Ports: left in, right out",
    entities: [box(30.48, 15.24, [-15.24, -7.62], 1.5), text("BLOCK", [-7, 1], 3), line([-15.24, 0], [-15.24 - 3 * U, 0]), line([15.24, 0], [15.24 + 3 * U, 0])],
    ports: [
      [-15.24 - 3 * U, 0],
      [15.24 + 3 * U, 0],
    ],
  },
  "block-cloud": {
    describe: "Cloud / broker block: MQTT, HTTP endpoint, or the platform the device talks to",
    entities: [
      arc([-10, 0], 8, 180, 360),
      arc([0, -4], 10, 180, 360),
      arc([10, 0], 8, 180, 360),
      line([-18, 0], [18, 0]),
      text("CLOUD", [-8, -1], 3),
    ],
    ports: [[0, 0]],
  },
  "block-gateway": {
    describe: "Gateway / hub block",
    entities: [box(35.56, 17.78, [-17.78, -8.89], 1.5), text("GATEWAY", [-11, 1], 3), line([-17.78, 0], [-17.78 - 3 * U, 0]), line([17.78, 0], [17.78 + 3 * U, 0])],
    ports: [
      [-17.78 - 3 * U, 0],
      [17.78 + 3 * U, 0],
    ],
  },
}

export const IOT: SymbolLibrary = {
  ...boards,
  ...sensors,
  ...actuators,
  ...radios,
  ...power,
  ...buses,
}
