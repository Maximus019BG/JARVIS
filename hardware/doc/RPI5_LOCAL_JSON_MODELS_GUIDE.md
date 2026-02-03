# Raspberry Pi 5 (4GB, 64-bit OS Lite) — local JSON→JSON model guidance (target: <5s)

This note is a **Pi 5–specific addendum** to [`hardware/doc/LOCAL_JSON_MODELS_FOR_BLUEPRINT_GEOMETRY.md`](hardware/doc/LOCAL_JSON_MODELS_FOR_BLUEPRINT_GEOMETRY.md:1). It answers: which previously recommended *local JSON→JSON* models are feasible on a **Raspberry Pi 5 4GB**, what **GGUF quantization + context** to use, **rough tokens/sec**, and **practical latency recommendations**.

Assumptions:

- Device: **Raspberry Pi 5 (4GB)**
- OS: **Raspberry Pi OS Lite 64-bit**
- Runtime: **CPU-only** (no CUDA; Vulkan may exist but is rarely worth the complexity for Pi 5)
- Stack: **[`llama.cpp`](https://github.com/ggerganov/llama.cpp)**
- Goal: **fast, reliable JSON-in/JSON-out** transforms (blueprint/geometry cleaning, normalization), using **grammar-constrained decoding** when strict JSON is required.

---

## 1) Pi 5 4GB constraints (what actually limits you)

### RAM budget reality

On a 4GB Pi 5, you do *not* get 4GB for the model:

- OS + services + page cache: commonly **0.7–1.3GB**
- Safe model+KV+buffers budget: typically **~2.0–2.8GB**

That budget must cover:

- **model weights** (GGUF)
- **KV cache** (grows with context length)
- scratch buffers / runtime overhead

### Latency target (<5s)

For “single-shot JSON transform” workloads, <5s usually means:

- keep **prompt short** (ideally **<600–1200 tokens** including schema/grammar constraints)
- keep **output short** (ideally **<200–500 tokens**)
- avoid huge contexts; don’t run 7B models at 8k context on Pi 4GB

In practice on Pi 5 CPU, **3B-class** models can hit this comfortably; **7B-class** might hit it only with tight settings and small generations.

---

## 2) Feasible previously-recommended models on Pi 5 4GB

From [`LOCAL_JSON_MODELS_FOR_BLUEPRINT_GEOMETRY.md`](hardware/doc/LOCAL_JSON_MODELS_FOR_BLUEPRINT_GEOMETRY.md:13), these are the realistic options:

### Feasible (recommended tier)

1) **Phi-3.5 Mini Instruct (~3.8B)** — best fit for Pi 5 4GB
- Why: strong instruction following for size; runs fast enough on CPU.
- Use when: you want consistent JSON transforms with minimal latency.

2) **Qwen2.5 1.5B / 3B Instruct** — if you can accept slightly weaker reasoning
- Note: the earlier doc highlights Qwen2.5 7B+ as “best overall”, but on **Pi 5 4GB** you generally want **≤3B**.
- Use when: you want speed, and can enforce structure via grammar.

3) **Llama 3.2 3B Instruct** (same ecosystem idea as Llama 3.1, but Pi-sized)
- The earlier doc names **Llama 3.1 8B**; on Pi 5 4GB the practical equivalent is **3B**.
- Use when: you want Llama-style instruction behavior in a smaller footprint.

### “Borderline / only if you really tune it”

4) **Llama 3.1 8B Instruct** — borderline on 4GB, not ideal for <5s
- It can *run* in heavy quantizations, but speed and RAM headroom are poor.
- Expect slow tokens/sec and frequent swapping risk if context is not kept tiny.

### Not recommended (too big for Pi 5 4GB)

- **Qwen2.5 7B / 14B / 32B / 72B** (7B may technically load in aggressive quants, but is not a good <5s choice)
- **Mistral 7B–12B class** (similar story: can be made to run, but latency/ram headroom will disappoint)
- **DeepSeek-R1-Distill 7B/14B/32B** (especially 14B+ is a non-starter here)

---

## 3) Quantization + context settings (GGUF) for Pi 5 4GB

### Quick rules

- Prefer **Q4_K_M** as the default “quality/speed” quant.
- Use **Q3_K_S** when RAM is tight or you want a smaller footprint.
- Avoid large context lengths; KV cache will kill you on 4GB.

### Recommended settings by model class

#### 3B–4B models (best Pi fit)

- Quantization:
  - **Primary:** `Q4_K_M`
  - **If you need more speed/less RAM:** `Q3_K_S`
- Context (`-c`): **1024–2048**
  - For strict <5s, start at **1024**.
- Output cap (`-n`): **128–512**

#### 7B models (borderline)

- Quantization:
  - **Minimum practical:** `Q3_K_S` (or other 3-bit K-quants)
  - `Q4_K_M` often pushes memory too close to the edge with any meaningful context.
- Context (`-c`): **512–1024**
- Output cap (`-n`): **<=256**

### Why context is expensive (KV cache)

KV cache memory scales roughly with:

- **layers × heads × head_dim × 2 (K+V) × context_tokens × bytes_per_element**

On Pi 5 4GB, the practical takeaway is: **keep `-c` small** unless you *must* retain long history. For “JSON transform” tasks, you almost never need long history.

---

## 4) Rough performance expectations (tokens/sec)

These are **order-of-magnitude** numbers for Pi 5 CPU in typical `llama.cpp` builds (NEON, aarch64), using a single request (no batching).

> Notes:
> - Tokens/sec varies heavily with build flags, thread count, quant, prompt length, and whether you’re prompt-processing vs generating.
> - Grammar-constrained decoding reduces throughput (see below).

### Ballpark generation throughput (decode)

- **~3B–4B, Q4_K_M, context 1k:** ~**8–18 tok/s**
- **~3B–4B, Q3_K_S, context 1k:** ~**10–22 tok/s**
- **~7B, Q3_K_S, context 1k:** ~**3–8 tok/s**

### Prompt processing is slower than decode

If your prompt (including schema/examples) is large, the “time-to-first-token” will dominate. This is why **prompt minimization** matters more than squeezing 1–2 tok/s from quant choice.

---

## 5) Practical recommendations to hit <5s

### A) Model size caps

- **Best cap:** **≤4B** parameters (Phi/Qwen/Llama 3B class)
- **Hard cap for sanity:** avoid **7B** on 4GB if you care about consistent low latency

### B) Minimize prompt tokens (this matters most)

For JSON→JSON transforms:

- Use **a short system instruction** (“return only JSON; obey schema/grammar; no commentary”).
- Use **one compact schema** (or grammar). Avoid long prose.
- Avoid multi-shot examples; use **0–1 minimal example**.
- Keep input JSON compact (no pretty printing).

### C) Use `llama.cpp` as a server

Running `llama.cpp` once and sending requests avoids repeated model load overhead and lets you tune threads. Use the built-in server:

- [`llama.cpp` HTTP server](https://github.com/ggerganov/llama.cpp/tree/master/examples/server)

### D) Grammar-constrained decoding overhead

Using GBNF grammars (or JSON-only grammars) makes outputs much more reliable, but costs throughput.

- Typical overhead: **~10–35% slower** decode (sometimes more if grammar is complex or highly restrictive).
- Recommendation: Use grammar for **final output**, keep grammar minimal:
  - prefer a grammar that enforces **JSON object shape + key set + numeric arrays**
  - avoid elaborate whitespace/permissive branches

If you can tolerate occasional repair, an alternative is:

1) generate “almost JSON” with low temperature
2) run a deterministic JSON repair + validate

…but for automation, grammar is usually worth it.

---

## 6) Shortlist (best 2–3 choices) for Pi 5 4GB

### Best choices

1) **Phi-3.5 Mini Instruct (GGUF, Q4_K_M, ctx 1024–2048)**
- Most likely to meet **<5s** while keeping acceptable transform quality.

2) **Qwen2.5 3B Instruct (GGUF, Q4_K_M, ctx ~1024)**
- Faster and smaller; use grammar to keep JSON strict.

3) **Llama 3.2 3B Instruct (GGUF, Q4_K_M, ctx ~1024)**
- Good ecosystem behavior; strong “instruction” feel in a small model.

### Not recommended list (too big / too slow / too RAM-hungry)

- **DeepSeek-R1-Distill 7B/14B/32B**
- **Qwen2.5 7B+** (especially 14B/32B/72B)
- **Mistral 7B–12B** class
- **Llama 3.1 8B** (borderline; will struggle to consistently hit <5s)

---

## 7) Concrete download pointers (model repos)

You typically want **GGUF** quants for `llama.cpp`. Easiest route:

- Hugging Face search for “**GGUF**” variants of the exact instruct model.
- Prefer well-known quant publishers (e.g., **bartowski**, **TheBloke**, **lmstudio-community**, etc.).

### Suggested starting points

- Phi family (look for Phi-3.5 Mini Instruct GGUF)
  - Microsoft org: https://huggingface.co/microsoft
  - Search query: `phi-3.5 mini instruct gguf`

- Qwen2.5 Instruct (choose 1.5B or 3B)
  - Qwen org: https://huggingface.co/Qwen
  - Search query: `qwen2.5 3b instruct gguf`

- Llama 3.x small (choose 3B if available as GGUF)
  - Meta Llama org: https://huggingface.co/meta-llama
  - Search query: `llama 3.2 3b instruct gguf`

> Pin the exact GGUF repo/filename you deploy in production (don’t rely on “latest”).

---

## 8) `llama.cpp` command lines (ARM64 / Pi 5)

These examples assume:

- you already built `llama.cpp` on the Pi (aarch64)
- you have a GGUF at `./models/<model>.gguf`

### A) Run the HTTP server (recommended)

```bash
./llama-server \
  -m ./models/model.Q4_K_M.gguf \
  -t 4 \
  -c 1024 \
  --host 0.0.0.0 \
  --port 8080 \
  --temp 0 \
  --top-p 1 \
  --repeat-penalty 1.1
```

Notes:

- `-t 4` is a good starting point on Pi 5; try `-t 3..6` and keep what yields lowest tail latency.
- Keep `-c` small (1024) for consistent RAM headroom.

### B) Run server with grammar-constrained decoding (strict JSON)

If you have a JSON grammar file (GBNF) such as `./grammars/your_schema.gbnf`:

```bash
./llama-server \
  -m ./models/model.Q4_K_M.gguf \
  -t 4 \
  -c 1024 \
  --temp 0 \
  --top-p 1 \
  --repeat-penalty 1.1 \
  --grammar-file ./grammars/your_schema.gbnf
```

Practical tips:

- Grammar + `--temp 0` is the “automation” mode.
- Expect ~10–35% slower decode vs no grammar.

### C) One-shot CLI generation (debugging)

```bash
./llama-cli \
  -m ./models/model.Q4_K_M.gguf \
  -t 4 \
  -c 1024 \
  -n 256 \
  --temp 0 \
  --top-p 1 \
  -p "You are a JSON transformer. Return ONLY JSON. Input: {...}"
```

---

## 9) Deployment pattern that consistently meets <5s

1) Use a **3B–4B instruct model** in `Q4_K_M`.
2) Keep `-c 1024` (or `2048` only if required).
3) Use `--temp 0`, moderate repeat penalty.
4) Enforce strictness with **GBNF grammar** (accepting throughput hit).
5) Keep the schema/grammar concise and the prompt minimal.
6) Cap output tokens (`-n`) to prevent runaway generations.

This combination is the most reliable way to hit **sub-5s** JSON transforms on **Raspberry Pi 5 4GB**.
