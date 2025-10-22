#include <Arduino.h>
#include "esp_camera.h"
#include "soc/soc.h"           // disable brownout problems
#include "soc/rtc_cntl_reg.h"
#include "driver/rtc_io.h"
#include "esp_log.h"

// This example initializes the OV2640 camera using the AI-Thinker pin mapping
// and performs a single frame capture as a test. WiFi and Bluetooth are not
// started here (no WiFi/BT) so the module only runs camera code.

static const char *TAG = "camera_test";

void setup() {
  // Disable brownout detector (common on some dev boards)
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  Serial.begin(115200);
  while (!Serial) delay(10);
  Serial.println("Starting camera init...");

  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = 5;
  config.pin_d1 = 18;
  config.pin_d2 = 19;
  config.pin_d3 = 21;
  config.pin_d4 = 36;
  config.pin_d5 = 39;
  config.pin_d6 = 34;
  config.pin_d7 = 35;
  config.pin_xclk = 0;
  config.pin_pclk = 22;
  config.pin_vsync = 25;
  config.pin_href = 23;
  config.pin_sscb_sda = 26;
  config.pin_sscb_scl = 27;
  config.pin_pwdn = 32;
  config.pin_reset = -1;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  // init with high specs to test, you can reduce size to save memory
  config.frame_size = FRAMESIZE_VGA;
  config.jpeg_quality = 12;
  config.fb_count = 1;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed with error 0x%x\n", err);
    ESP_LOGE(TAG, "Camera init failed: 0x%x", err);
    while (true) {
      delay(1000);
    }
  }

  Serial.println("Camera initialized, capturing a frame...");
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("Camera capture failed");
  } else {
    Serial.printf("Captured frame: %u bytes, w=%d h=%d\n", fb->len, fb->width, fb->height);
    // Normally you'd process or send the JPEG here.
    esp_camera_fb_return(fb);
  }
}

void loop() {
  // Do nothing. If you want repeated captures, move capture code here.
  delay(1000);
}