# Item model

`/api/vision/items` and `/api/vision/detect` load `dinov2-small.onnx` from here on first request:

```bash
curl -L -o web/models/items/dinov2-small.onnx https://huggingface.co/onnx-community/dinov2-small/resolve/main/onnx/model_quantized.onnx
```

DINOv2 ViT-S/14, int8, ~24MB, CPU only. Any input size in multiples of 14; the routes use 448px on the long side (~80ms on a laptop).
A different model only means changing `tui/src/pi/items.ts`, which turns a photo into patch features.
