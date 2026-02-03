# Local open-weight LLMs for JSON→JSON “blueprint/geometry” transforms

This document recommends **open-weight models you can run locally (CPU/GPU)** that are well-suited to:

- taking **structured text input (JSON)**, e.g. `lines:{...}` with line segments (`x0,y0,x1,y1`),
- producing **structured text output (JSON)**, ideally conforming to a schema,
- using **tool-use / function-call style prompting** or constrained decoding to keep outputs valid.

The focus is practical: models that work well with **JSON-in/JSON-out** when paired with **constrained decoding** (e.g., [`llama.cpp` grammars](https://github.com/ggerganov/llama.cpp)), **schema prompting**, or structured-output libraries.

---

## 1) Top recommended models (open-weight, local-friendly)

These models are widely used for local inference and tend to behave well with structured output when combined with the prompting/decoding patterns below.

> Notes
>
> - **Context lengths** vary by serving stack and model variant. Treat them as typical/advertised values.
> - **“License”** below is the model’s own license (not necessarily Apache/MIT). Always verify for your use-case.

### A. Qwen2.5 (Instruct) — best overall structured output for the size

- Sizes: **7B**, **14B**, **32B**, **72B** (pick based on VRAM)
- Context length: commonly **32k** (varies by release)
- License: **Qwen license** (open-weight; check terms)
- Why it fits JSON→JSON:
  - Strong instruction following and **reliable key/value formatting**.
  - Handles “transform this JSON into that JSON” tasks very well.
  - Good balance of speed and quality at 7B/14B.

Links:
- Model family landing page: https://huggingface.co/Qwen
- Paper / family overview: https://qwenlm.github.io/

### B. Llama 3.1 (Instruct) — stable, strong tool-use prompting ecosystem

- Sizes: **8B**, **70B**
- Context length: typically **128k** for Llama 3.1 variants
- License: **Meta Llama 3.x license**
- Why it fits JSON→JSON:
  - Excellent ecosystem support (many runtimes + examples).
  - Often produces clean JSON with proper prompting.
  - Strong reasoning for geometry-ish transforms (merge collinear segments, normalize, snap-to-grid, etc.).

Links:
- Model hub: https://huggingface.co/meta-llama
- License/usage terms (Meta): https://ai.meta.com/resources/models-and-libraries/llama/

### C. Mistral Small / Nemo (Instruct) — fast, practical, good structured adherence

- Sizes: commonly **7B–12B class** (varies by release line)
- Context length: commonly **8k–32k** depending on variant
- License: **Mistral license** (open-weight; verify terms)
- Why it fits JSON→JSON:
  - Good instruction following at small sizes.
  - Strong “production-ish” feel for extraction/transforms.

Links:
- Mistral models on HF: https://huggingface.co/mistralai
- Mistral model docs: https://docs.mistral.ai/

### D. DeepSeek-R1-Distill (Qwen/Llama distilled variants) — better reasoning per parameter

- Sizes: commonly **7B**, **14B**, **32B** distilled variants
- Context length: depends on the base (often **32k**)
- License: varies by release (verify per checkpoint)
- Why it fits JSON→JSON:
  - Strong “thinking” ability for geometric cleanup and rule-based transforms.
  - When paired with **grammar-constrained decoding**, can produce high-quality structured results.

Links:
- DeepSeek on HF: https://huggingface.co/deepseek-ai

### E. Phi-3.5 (mini/small instruct) — CPU-friendly option for simpler transforms

- Sizes: **~3B–7B** class
- Context length: often **8k–128k** depending on variant
- License: Microsoft research/community license (verify)
- Why it fits JSON→JSON:
  - Can be quite usable on CPU for straightforward formatting and light geometry rules.
  - Lower VRAM footprint; good “always-on” local service.

Links:
- Phi on HF: https://huggingface.co/microsoft

---

## 2) Prompting patterns for “guaranteed JSON”

No LLM can *mathematically guarantee* valid JSON in all cases without help, but you can get extremely close by combining:

1) **Schema-first prompting**
2) **Stop/temperature controls**
3) **Constrained decoding** (preferred)

### 2.1 Schema-first prompting (works everywhere)

Provide:

- A **strict JSON Schema** (or at least a pseudo-schema)
- A “**return only JSON**” rule
- Explicitly forbid extra keys
- Include one short example

Pattern (pseudo):

```text
System: You are a JSON transformer. Output must be valid JSON and must match the schema.
User: Here is the input JSON: ...
User: Output JSON must match this JSON Schema: ...
User: Return only JSON. No markdown. No explanation.
```

Add practical decoding knobs:

- `temperature: 0` or very low
- `top_p: 1` (or modest)
- `repeat_penalty` tuned (avoid loops)
- Stop sequences like `\n\n` only if you know the model won’t need them

### 2.2 Constrained decoding (best: enforce JSON structure)

#### A) [`llama.cpp` GBNF grammars](https://github.com/ggerganov/llama.cpp)

`llama.cpp` supports **grammar-based constrained decoding**. You can provide a grammar that forces:

- valid JSON tokens
- fixed keys
- numeric arrays, object shapes, etc.

This is very effective for “line segments list” outputs.

#### B) JSON Schema constrained decoding in servers

Some servers and libraries support **JSON Schema** or structured output constraints:

- vLLM has ongoing/optional structured output features depending on version and backend.
- Many OpenAI-compatible servers add “response_format: json_schema” style APIs.

If your stack supports JSON-schema constraints, prefer it over pure prompting.

#### C) Libraries: Outlines / Jsonformer

- **Outlines**: structured generation via regex/CFG-like constraints.
  - Repo: https://github.com/dottxt-ai/outlines
- **Jsonformer**: forces JSON structure by filling value slots.
  - Repo: https://github.com/1rgs/jsonformer

These approaches help when you need strict compliance and you control the inference pipeline.

---

## 3) Example: blueprint-like `lines:{...}` prompt + output

### Example input

Assume your app uses a `lines:{...}` JSON object (you can adapt key names). Example:

```json
{
  "lines": {
    "units": "px",
    "segments": [
      {"x0": 10, "y0": 10, "x1": 110, "y1": 10},
      {"x0": 110, "y0": 10, "x1": 110, "y1": 60},
      {"x0": 12, "y0": 10, "x1": 108, "y1": 10}
    ],
    "meta": {"source": "sketch_v1"}
  }
}
```

### Target task

- Normalize/simplify segments:
  - Merge near-duplicate horizontal lines.
  - Snap endpoints to an integer grid.
  - Preserve axis-aligned nature.

### Example prompt (schema + strict output)

```text
System:
You transform geometry JSON to geometry JSON.
Return ONLY valid JSON. No markdown, no commentary.
If you cannot comply, return {"error":"cannot_comply"}.

User:
Input JSON (lines:{...}):
{"lines":{"units":"px","segments":[{"x0":10,"y0":10,"x1":110,"y1":10},{"x0":110,"y0":10,"x1":110,"y1":60},{"x0":12,"y0":10,"x1":108,"y1":10}],"meta":{"source":"sketch_v1"}}}

User:
Output JSON MUST match this schema:
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "lines": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "units": {"type": "string"},
        "segments": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "x0": {"type": "number"},
              "y0": {"type": "number"},
              "x1": {"type": "number"},
              "y1": {"type": "number"}
            },
            "required": ["x0","y0","x1","y1"]
          }
        },
        "meta": {"type": "object"}
      },
      "required": ["units","segments"]
    },
    "operations": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "op": {"type": "string"},
          "count": {"type": "integer"}
        },
        "required": ["op","count"]
      }
    }
  },
  "required": ["lines"]
}

User:
Perform: merge collinear duplicates within tolerance=2px; snap all coordinates to integers.
Return only the JSON.
```

### Example output

```json
{
  "lines": {
    "units": "px",
    "segments": [
      {"x0": 10, "y0": 10, "x1": 110, "y1": 10},
      {"x0": 110, "y0": 10, "x1": 110, "y1": 60}
    ],
    "meta": {"source": "sketch_v1"}
  },
  "operations": [
    {"op": "snap_to_integer", "count": 3},
    {"op": "merge_duplicate_collinear", "count": 1}
  ]
}
```

---

## 4) Minimal runtime stacks (local) + quantization notes

### Option 1: [`llama.cpp`](https://github.com/ggerganov/llama.cpp) (CPU/GPU, best portability)

Why:

- Runs on CPU and many GPUs.
- First-class support for **quantized GGUF** models.
- Supports **grammar-constrained decoding** (GBNF), which is excellent for JSON.

Typical usage patterns:

- Use a GGUF quant (e.g., `Q4_K_M`, `Q5_K_M`) for speed.
- Enable grammar constraints for output.

### Option 2: [`Ollama`](https://ollama.com/) (fastest “developer UX”)

Why:

- Very easy local serving.
- Good for rapid iteration.

Caveat:

- Constrained decoding features vary by model/runtime; you may rely more on schema prompting unless you integrate additional constraints.

### Option 3: [`vLLM`](https://github.com/vllm-project/vllm) (GPU throughput)

Why:

- High throughput on NVIDIA GPUs.
- Good for batching many blueprint transformations.

Caveat:

- Structured output constraints depend on version and configuration; if strict JSON is mandatory, combine with schema prompting or an external constraint library.

### Quantization notes

- **4-bit quant** (e.g., GGUF Q4 variants) is usually the best “speed/quality” sweet spot for local.
- **5–6 bit** improves reliability on complex transforms.
- If you see JSON corruption (missing braces, trailing text), try:
  - slightly higher bit quant,
  - lower temperature,
  - grammar constraints,
  - a model with stronger instruction following (e.g., Qwen2.5).

Background:
- GGUF/GGML ecosystem: https://github.com/ggerganov/llama.cpp

---

## 5) Decision matrix (quality vs speed vs VRAM)

Rule of thumb: for JSON-in/JSON-out geometry transforms, **7B–14B** is often enough, especially with grammars.

| Model (typical) | Quality on geometry transforms | JSON reliability (w/ grammar) | Speed (local) | VRAM need (rough) | Best for |
|---|---:|---:|---:|---:|---|
| Qwen2.5 7B Instruct | High | Very high | Fast | ~6–10 GB (FP16); ~4–6 GB (4-bit) | Default choice |
| Llama 3.1 8B Instruct | High | Very high | Fast | ~6–10 GB; ~4–6 GB (4-bit) | Tool-use ecosystems |
| Mistral (7B–12B) Instruct | Med–High | High | Very fast | ~6–14 GB; ~4–8 GB (4-bit) | Low-latency services |
| DeepSeek-R1-Distill 14B | High | Very high | Medium | ~14–20 GB; ~8–10 GB (4-bit) | Harder rule transforms |
| Qwen2.5 32B Instruct | Very high | Very high | Slow–Med | ~32–48 GB; ~18–24 GB (4-bit) | Maximum accuracy locally |

Notes:

- VRAM numbers depend heavily on context length, KV cache settings, and serving stack.
- For CPU-only machines, prefer **smaller models + quantization** (Q4/Q5) and keep context modest.

---

## Practical recommendations (quick picks)

- **Best all-around local model:** Qwen2.5 7B or 14B Instruct + `llama.cpp` + JSON grammar.
- **Most robust ecosystem:** Llama 3.1 8B Instruct + schema prompting + grammar if possible.
- **CPU-first:** Phi family small instruct + tight schema + post-JSON validation.

---

## References / further reading

- [`llama.cpp` (grammars, GGUF, local inference)](https://github.com/ggerganov/llama.cpp)
- [Outlines (structured generation)](https://github.com/dottxt-ai/outlines)
- [Jsonformer (forced JSON templates)](https://github.com/1rgs/jsonformer)
- [vLLM (high-throughput serving)](https://github.com/vllm-project/vllm)
- [Ollama (local serving UX)](https://ollama.com/)
- [Hugging Face model hub (browse specific checkpoints)](https://huggingface.co/models)
