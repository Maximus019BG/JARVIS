# Raspberry Pi 5 Agent LLM Recommendations (4GB-first)

> Platform target: **Raspberry Pi 5**, **4GB RAM**, **Raspberry Pi OS Lite**, CPU-only inference.

This document consolidates Raspberry Pi 5–relevant **throughput (tokens/s)** and **RAM footprint** measurements from published benchmarks, and turns them into **agent-by-agent model picks** with explicit **quantization** and **context caps**.

## Related docs in this repo

- Blueprint-specific model notes: [`hardware/doc/AI_MODELS_FOR_BLUEPRINTS.md`](hardware/doc/AI_MODELS_FOR_BLUEPRINTS.md:1)
- Other local JSON / geometry model notes: [`hardware/doc/LOCAL_JSON_MODELS_FOR_BLUEPRINT_GEOMETRY.md`](hardware/doc/LOCAL_JSON_MODELS_FOR_BLUEPRINT_GEOMETRY.md:1)

## Sources (deep research)

- KV-cache / context drives memory; set explicit ctx: https://github.com/ggml-org/llama.cpp/discussions/9784
- llama.cpp quantization guidance (K-quants; Q4_K_M recommended; Q2_K not recommended): https://github.com/ggml-org/llama.cpp/discussions/2094
- Pi 5 LLM performance + resource notes (includes SmolLM2 1.7B RAM >5GB remark; llama.cpp vs ollama speed delta): https://www.stratosphereips.org/blog/2025/6/5/how-well-do-llms-perform-on-a-raspberry-pi-5
- Pi 5 table with concrete tok/s + RAM (Q4_K_M): https://rpubs.com/harpomaxx/rpi5llm
- Additional tok/s + RAM table for Qwen3 smalls on ARM board (llama.cpp): https://pamir-ai.hashnode.dev/qwen-3-on-a-raspberry-pi-5-small-models-big-agent-energy
- Phi compatibility risk thread (conversion / tensor shape / arch support issues): https://github.com/ggml-org/llama.cpp/issues/7439
- Phi-3.5 mini GGUF card (128K context spec; file sizes): https://huggingface.co/QuantFactory/Phi-3.5-mini-instruct-GGUF

---

## 1) Executive summary

- **Always cap context (`-c`) on Pi 5.** KV cache can be multiple GB, and llama.cpp will often allocate for the model’s maximum context unless you set it.
  - In a llama.cpp discussion, a user noted Gemma 9B at ctx 8192 uses **~2.8 GB** just for KV cache and recommended trying `-c 4096` to reduce memory.
  - A maintainer also emphasized setting context explicitly (example `-c 512`) when defaults surprise you.
  - Source: https://github.com/ggml-org/llama.cpp/discussions/9784

- **Default quant choice for 4GB: `Q4_K_M`.** The llama.cpp `quantize --help` table (quoted in discussion) marks `Q4_K_M` as **recommended** (balanced quality) and explicitly says `Q2_K` is **not recommended** due to extreme quality loss.
  - Source: https://github.com/ggml-org/llama.cpp/discussions/2094

- **Practical 4GB sweet spot models:** pick **1B–3B** class, `Q4_K_M`, and cap ctx around **1024–2048** (sometimes **4096** if you can tolerate tighter headroom).

- **Numbers you can plan around (Pi 5, from rpubs table):**
  - `gemma3:1b` `Q4_K_M`: **11.53 tok/s**, **1393.8 MB** RAM
  - `llama3.2:1b-instruct` `Q4_K_M`: **11.22 tok/s**, **2415.8 MB** RAM
  - `qwen2.5:1.5b` `Q4_K_M`: **9.97 tok/s**, **1849.3 MB** RAM
  - `qwen2.5:3b` `Q4_K_M`: **5.2 tok/s**, **3025.9 MB** RAM
  - `llama3.2:3b` `Q4_K_M`: **4.69 tok/s**, **4659.3 MB** RAM (**exceeds 4GB**)
  - `smollm2:1.7b-instruct` `Q4_K_M`: **8.23 tok/s**, **5318.2 MB** RAM (**exceeds 4GB**)

  Source: https://rpubs.com/harpomaxx/rpi5llm

- **Phi models:** even if a model advertises very long context (e.g., Phi-3.5-mini supports **128K** context), on Pi 5 you must still cap ctx aggressively.
  - Phi-family compatibility in llama.cpp has had breakage risks, so it should be treated as **optional**, not baseline.
  - Sources: https://huggingface.co/QuantFactory/Phi-3.5-mini-instruct-GGUF and https://github.com/ggml-org/llama.cpp/issues/7439

---

## 2) Per-agent recommended models (with ctx caps, expected tok/s and RAM)

### How to read this table

- **Quant:** prefer `Q4_K_M` unless stated.
- **ctx cap:** recommended `-c` for llama.cpp (or equivalent). This is a *reliability cap*, not a capability statement.
- **Expected tok/s + RAM:** where available, these are directly from cited benchmark tables.

> RAM footprint depends heavily on ctx (KV cache) and runtime buffers. The cited RAM numbers are point measurements under the benchmark’s settings; changing ctx, batch, threads changes RAM. This is why ctx caps matter: https://github.com/ggml-org/llama.cpp/discussions/9784

| Agent role | Primary pick | Quant | ctx cap (4GB) | Expected tok/s | Expected RAM | Backup pick | Quant | ctx cap | Expected tok/s | Expected RAM | Notes |
|---|---|---|---:|---:|---:|---|---|---:|---:|---:|---|
| **Base** (general assistant) | Qwen 2.5 3B | Q4_K_M | 1024–2048 | 5.2 | 3025.9 MB | Qwen 2.5 1.5B | Q4_K_M | 2048 | 9.97 | 1849.3 MB | 3B is often the largest practical size on 4GB; keep ctx tight. Source: https://rpubs.com/harpomaxx/rpi5llm |
| **Blueprint** (structured specs / geometry prompts) | Qwen 2.5 3B | Q4_K_M | 1024–2048 | 5.2 | 3025.9 MB | Gemma 3 1B | Q4_K_M | 2048 | 11.53 | 1393.8 MB | If 3B causes pressure, drop to 1B and rely on strict JSON/tool schemas. Sources: https://rpubs.com/harpomaxx/rpi5llm and ctx/KV warning: https://github.com/ggml-org/llama.cpp/discussions/9784 |
| **Coder** (short diffs, patching) | Qwen 2.5 3B | Q4_K_M | 1024 | 5.2 | 3025.9 MB | Llama 3.2 1B Instruct | Q4_K_M | 1024 | 11.22 | 2415.8 MB | For code tasks, prioritize responsiveness; keep ctx smaller than chat. Source: https://rpubs.com/harpomaxx/rpi5llm |
| **Critic** (sanity checks) | Gemma 3 1B | Q4_K_M | 1024–2048 | 11.53 | 1393.8 MB | Qwen 2.5 1.5B | Q4_K_M | 1024–2048 | 9.97 | 1849.3 MB | Critic needs consistency more than long ctx; small model + strict rubric works. Source: https://rpubs.com/harpomaxx/rpi5llm |
| **Memory** (summarize / extract) | Gemma 3 1B | Q4_K_M | 2048–4096 | 11.53 | 1393.8 MB | Llama 3.2 1B Instruct | Q4_K_M | 2048 | 11.22 | 2415.8 MB | Memory pipelines should summarize aggressively; cap ctx to avoid KV cache spikes. Sources: https://rpubs.com/harpomaxx/rpi5llm and https://github.com/ggml-org/llama.cpp/discussions/9784 |
| **Orchestrator** (route + tool plan) | Qwen 2.5 1.5B | Q4_K_M | 2048 | 9.97 | 1849.3 MB | Gemma 3 1B | Q4_K_M | 2048 | 11.53 | 1393.8 MB | Keep one model loaded to avoid memory duplication. Source: https://www.stratosphereips.org/blog/2025/6/5/how-well-do-llms-perform-on-a-raspberry-pi-5 |
| **Planner** (task decomposition) | Qwen 2.5 3B (conditional) | Q4_K_M | 1024–2048 | 5.2 | 3025.9 MB | Qwen 2.5 1.5B | Q4_K_M | 2048 | 9.97 | 1849.3 MB | 3B is better but can crowd RAM; 1.5B is safer for always-on. Source: https://rpubs.com/harpomaxx/rpi5llm |
| **Research** (synthesis w/ tools) | Gemma 3 1B | Q4_K_M | 2048–4096 | 11.53 | 1393.8 MB | Qwen 2.5 1.5B | Q4_K_M | 2048 | 9.97 | 1849.3 MB | Research should lean on tools; small model does synthesis and citation formatting. Source: https://rpubs.com/harpomaxx/rpi5llm |

### Extra “tool caller” options (Qwen3 smalls)

Pamir’s ARM A76 llama.cpp measurements (not exactly Pi 5, but similar CPU class) provide additional points:

- Qwen 3 1.7B **Q8**: **8.69 tok/s**, **1.20 GB** RAM
- Qwen 3 1.7B **Q4_K_M**: **5.42 tok/s**, **1.90 GB** RAM
- Qwen 3 0.6B **Q8**: **21.48 tok/s**, **0.53 GB** RAM

Source: https://pamir-ai.hashnode.dev/qwen-3-on-a-raspberry-pi-5-small-models-big-agent-energy

---

## 3) 4GB reliability rules (Do / Don’t)

### Do

- **Set context explicitly** for every runtime invocation.
  - Maintainer advice and KV-cache notes: https://github.com/ggml-org/llama.cpp/discussions/9784

- **Prefer K-quants, especially `Q4_K_M`.**
  - `Q4_K_M` recommended; `Q2_K` not recommended: https://github.com/ggml-org/llama.cpp/discussions/2094

- **Keep one model loaded at a time** on 4GB.
  - Stratosphere post uses settings like `OLLAMA_MAX_LOADED_MODELS=1` to conserve memory; the principle applies generally. Source: https://www.stratosphereips.org/blog/2025/6/5/how-well-do-llms-perform-on-a-raspberry-pi-5

### Don’t

- **Don’t rely on advertised max context (8K/128K) on 4GB.**
  - Phi-3.5-mini advertises **128K**: https://huggingface.co/QuantFactory/Phi-3.5-mini-instruct-GGUF
  - But KV cache will dominate without caps: https://github.com/ggml-org/llama.cpp/discussions/9784

- **Don’t use `Q2_K` unless you must fit at all costs.**
  - Explicit “not recommended”: https://github.com/ggml-org/llama.cpp/discussions/2094

- **Don’t plan on SmolLM2 1.7B or Llama 3.2 3B on 4GB** if the benchmarked configuration matches yours.
  - They measured **5318.2 MB** and **4659.3 MB** RAM in the Pi 5 table. Source: https://rpubs.com/harpomaxx/rpi5llm

---

## 4) Why some popular models are excluded (or treated as optional)

### SmolLM2 1.7B

- Excluded for **4GB** because a Pi 5 benchmark table shows **5318.2 MB** RAM at `Q4_K_M`.
- The Stratosphere post also notes a high footprint (over 5 GB).

Sources:
- https://rpubs.com/harpomaxx/rpi5llm
- https://www.stratosphereips.org/blog/2025/6/5/how-well-do-llms-perform-on-a-raspberry-pi-5

### Llama 3.2 3B

- Excluded for **4GB** because it measured **4659.3 MB** RAM in the Pi 5 table.

Source: https://rpubs.com/harpomaxx/rpi5llm

### Phi family (Phi-3 small / some variants)

- Treated as **optional** because llama.cpp support has seen architecture/shape issues:
  - Issue reports conversion working for some variants but inference failing with tensor shape mismatch, and `Phi3SmallForCausalLM` not being supported by tooling at the time.

Source: https://github.com/ggml-org/llama.cpp/issues/7439

- Also: Phi-3.5-mini advertises **128K** context, which is not usable on 4GB without aggressive ctx caps.

Source: https://huggingface.co/QuantFactory/Phi-3.5-mini-instruct-GGUF

---

## Appendix A: Pi 5 benchmark numbers (Q4_K_M)

From https://rpubs.com/harpomaxx/rpi5llm:

| Model | Quant | RAM (MB) | tok/s |
|---|---|---:|---:|
| gemma3:1b | Q4_K_M | 1393.8 | 11.53 |
| llama3.2:1b-instruct | Q4_K_M | 2415.8 | 11.22 |
| qwen2.5:1.5b | Q4_K_M | 1849.3 | 9.97 |
| qwen2.5:3b | Q4_K_M | 3025.9 | 5.2 |
| llama3.2:3b | Q4_K_M | 4659.3 | 4.69 |
| smollm2:1.7b-instruct | Q4_K_M | 5318.2 | 8.23 |
| granite3.1-dense:2b | Q4_K_M | 3697.7 | 5.81 |

## Appendix B: ARM A76 (Pamir) numbers (llama.cpp)

From https://pamir-ai.hashnode.dev/qwen-3-on-a-raspberry-pi-5-small-models-big-agent-energy:

| Model | Quant | RAM (GB) | tok/s (4 threads) |
|---|---|---:|---:|
| Qwen 3 0.6B | Q8 | 0.53 | 21.48 |
| Qwen 3 1.7B | Q8 | 1.20 | 8.69 |
| Qwen 3 1.7B | Q4_K_M | 1.90 | 5.42 |
| Qwen 2.5 3B instruct | Q4_K_M | 1.3 | 5.21 |

## Appendix C: Implementation knobs (llama.cpp)

- Always set `-c N` to cap context and control KV cache memory.
  - Source: https://github.com/ggml-org/llama.cpp/discussions/9784
- Prefer `Q4_K_M` (or `Q5_K_*` if you have headroom) and avoid `Q2_K`.
  - Source: https://github.com/ggml-org/llama.cpp/discussions/2094
