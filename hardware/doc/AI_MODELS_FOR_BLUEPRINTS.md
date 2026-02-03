# AI models for engineering blueprints (CAD, floorplans, schematics)

This document surveys AI model families that are **useful for generating, understanding, editing, and reasoning about engineering blueprints** (architectural floorplans, MEP/structural drawings, electrical schematics) and **CAD / 3D geometry** (parametric CAD, meshes). It focuses on models you can realistically integrate into this repo’s “blueprint” workflows.

> Scope notes
> - “Blueprint” is ambiguous: sometimes it means an image/PDF drawing, other times a structured CAD graph. Model choice depends heavily on whether your source of truth is **pixels**, **vectors**, or **parametric features**.
> - For CAD/engineering, a robust pipeline typically combines: **(1) multimodal VLM** → **(2) document/layout/OCR** → **(3) domain extraction + verification** → **(4) a deterministic CAD/EDA tool**.

---

## Categories (what models you need)

### 1) LLMs for plan/spec reasoning (text-first)
**Best for:** requirements understanding, code generation (CAD scripts), constraint reasoning, change requests, BOM/spec extraction, writing/reading plan notes.

- **Inputs:** text specs, extracted labels/dimensions, structured entities from OCR/vector parsing.
- **Outputs:** structured JSON, rules/constraints, code (e.g., CADQuery/OpenSCAD), change diffs, QA checks.
- **Strengths:** long-context reasoning; tool-use; reliable structured outputs with schema enforcement.
- **Limits:** cannot “see” a drawing unless paired with VLM + OCR; may hallucinate dimensions.

### 2) Multimodal vision-language models (VLMs) for plans/drawings
**Best for:** reading floorplans/schematics from images/PDF pages, understanding spatial relationships, answering questions (“where is room X?”), generating markup instructions.

- **Inputs:** images (PNG/JPG), PDF page renders, optionally text prompts.
- **Outputs:** captions, Q&A, structured extraction, region descriptions, sometimes coordinates (model-dependent).
- **Strengths:** handles noisy scans, mixed text+graphics, and “document-like” layouts.
- **Limits:** precise geometry is hard; scale/units/dimensions are fragile; coordinate grounding varies.

### 3) Document AI components (OCR, layout, tables)
**Best for:** *reliable* extraction of text, symbols, and layout from PDFs/scans; producing machine-readable annotations.

- **Inputs:** PDF, image.
- **Outputs:** text, bounding boxes, reading order, tables.
- **Strengths:** higher precision than generic VLMs for raw text extraction.
- **Limits:** doesn’t understand engineering semantics by itself.

### 4) Generative models for CAD / 3D
Split into:

**A. Text-to-CAD (parametric sequences / CAD code)**
- **Inputs:** textual description, constraints, sometimes sketch images.
- **Outputs:** CAD code (OpenSCAD, CADQuery), feature sequences, or procedural DSL.
- **Strengths:** editable parametric artifacts; diff-friendly.
- **Limits:** few robust foundation models; often research prototypes; requires verification.

**B. Image-to-3D / text-to-3D (meshes / NeRF / Gaussian splats)**
- **Inputs:** image(s) or text.
- **Outputs:** mesh/point cloud/gaussian representation.
- **Strengths:** fast approximate geometry.
- **Limits:** not engineering-grade; lacks constraints/dimensions; topology/accuracy issues.

---

## Notable models (commercial + open)

### A) Frontier multimodal models (plan understanding / Q&A)

#### OpenAI [`platform.openai.com/docs/models/gpt-4o`](https://platform.openai.com/docs/models/gpt-4o)
- **Type:** commercial VLM.
- **Typical tasks:** interpret plan images, classify symbols, explain drawing notes, generate structured extraction with tool help.
- **I/O:** image+text → text/JSON (and in some workflows can call tools).
- **Strengths:** strong general vision+reasoning; good at “document-style” images.
- **Limits:** coordinate-accurate extraction is not guaranteed; needs OCR/verification for dimensions.
- **Availability:** OpenAI API; see vision guide [`platform.openai.com/docs/guides/images-vision`](https://platform.openai.com/docs/guides/images-vision).

#### Google Gemini (Vision)
- **Type:** commercial VLM.
- **Typical tasks:** similar to GPT-4o; strong on long context and multimodal reasoning.
- **Availability:** Google AI Studio / Vertex AI (licensing and quotas vary).
- **Note:** pick if your stack is already Google Cloud-first.

#### Anthropic Claude (Vision)
- **Type:** commercial VLM.
- **Typical tasks:** document-style understanding, long prompts, spec reasoning plus image context.
- **Availability:** Anthropic API / cloud providers.

### B) Strong open(-ish) VLMs (self-host option)

#### Qwen-VL / Qwen2.5-VL
- **Type:** open-weight VLM family.
- **Use:** image+text understanding; often competitive for document/diagram tasks.
- **Links:**
  - Intro post: [`qwenlm.github.io/blog/qwen-vl/`](https://qwenlm.github.io/blog/qwen-vl/)
  - Overview of Qwen2.5-VL: [`roboflow.com/model/qwen2-5-vl`](https://roboflow.com/model/qwen2-5-vl)
- **Strengths:** viable self-hosted multimodal stack; good community tooling.
- **Limits:** deployment complexity; performance depends on variant + VRAM.

#### Mistral Pixtral
- **Type:** open-weight / commercial-served VLMs.
- **Models:** Pixtral 12B (open weights) and Pixtral Large (commercial).
- **Links:**
  - Announcement: [`mistral.ai/news/pixtral-12b`](https://mistral.ai/news/pixtral-12b)
  - Model card: [`huggingface.co/mistralai/Pixtral-12B-2409`](https://huggingface.co/mistralai/Pixtral-12B-2409)
  - Paper: [`arxiv.org/abs/2410.07073`](https://arxiv.org/abs/2410.07073)
- **Strengths:** good at document understanding; attractive for on-prem.
- **Limits:** still not a CAD extractor; pair with OCR/vectorization.

### C) Segmentation / detection models (preprocessing drawings)

#### Meta Segment Anything (SAM / SAM 2)
- **Type:** open(-ish) segmentation foundation model.
- **Use:** isolate regions (rooms, symbols, title blocks) before OCR/VLM; create masks for editing workflows.
- **Link:** [`ai.meta.com/research/sam2/`](https://ai.meta.com/research/sam2/)
- **Strengths:** promptable segmentation; useful glue for blueprint pipelines.
- **Limits:** doesn’t label semantics; needs prompts or downstream classifier.

### D) OCR / Document AI (reliability layer)
- **Options:** Tesseract OCR (open), PaddleOCR (open), cloud OCR (Google/AWS/Azure).
- **Why it matters:** dimension strings, callouts, and part numbers are safety-critical—extract them deterministically, then let an LLM reason about the extracted entities.

### E) CAD / 3D generation models

#### Text-to-CAD (research direction)
There is active research on converting text into CAD feature sequences and improving LLMs with CAD-specific datasets.

- **Survey-ish entry point:** “Large Language Models for Computer-Aided Design …” (ASME Journal of Mechanical Design) [`asmedigitalcollection.asme.org/mechanicaldesign/article/147/4/041710/1212251/Large-Language-Models-for-Computer-Aided-Design`](https://asmedigitalcollection.asme.org/mechanicaldesign/article/147/4/041710/1212251/Large-Language-Models-for-Computer-Aided-Design)
- **Practical takeaway:** today, the most robust approach is *still* “LLM generates CAD script/DSL” + “CAD kernel validates geometry”.

#### Image-to-3D (approximate geometry)

##### TripoSR
- **Type:** open-source image-to-3D reconstruction.
- **Link:** GitHub (MIT): [`github.com/VAST-AI-Research/TripoSR`](https://github.com/VAST-AI-Research/TripoSR)
- **Strengths:** fast single-image 3D; permissive MIT.
- **Limits:** not dimension-accurate; suited for visualization/prototyping, not engineering CAD.

---

## Typical pipeline patterns (inputs/outputs)

### Pattern 1: “Plan Q&A” from PDFs
1. Render PDF pages to images
2. OCR for text + bounding boxes
3. VLM answers questions *with citations to regions* (where possible)
4. LLM converts answers into structured project state (JSON)

**Inputs:** PDF, question.
**Outputs:** answer text + extracted entities (rooms, areas, labels).

### Pattern 2: “Convert plan → structured graph”
1. Preprocess: de-skew, binarize, detect page frames/title blocks
2. Segment regions (SAM2 or domain detector)
3. Vectorize (lines/arches) + symbol detection (doors/windows/electrical)
4. LLM/VLM performs semantic joining + consistency checks

**Inputs:** raster plan.
**Outputs:** graph (rooms/walls/openings), layers, metrics.

### Pattern 3: “Text-to-parametric CAD”
1. LLM produces CADQuery/OpenSCAD code under strict schema and style rules
2. Run CAD kernel/headless rendering
3. Validate: bounding boxes, constraints, intersections, unit tests
4. Iterate with visual feedback loop (render → VLM critique → patch)

**Inputs:** spec + constraints.
**Outputs:** code + rendered previews + verified measurements.

---

## Strengths / limits by task

### Understanding drawings (floorplans/schematics)
- **Use VLMs** for high-level interpretation and question answering.
- **Use OCR/layout** for text/dimensions; store extracted text with coordinates.
- **Main failure modes:** hallucinated dimensions, missed small annotations, symbol confusion across drafting standards.

### Editing drawings (markup, redlines)
- VLM can propose edits, but the safest workflow is:
  - **generate a patch plan** (structured diff),
  - **apply via deterministic renderer/editor**,
  - **re-validate**.

### Generating CAD/3D
- For engineering-grade outputs, prefer **parametric code generation** (CADQuery/OpenSCAD) over mesh-only generation.
- Mesh generation is fine for “preview” but not tolerance-critical manufacturing.

---

## Licensing / availability quick view (high-level)

| Model/family | Class | Self-host | License/terms (summary) | Good for |
|---|---:|---:|---|---|
| GPT-4o | commercial VLM | No | API terms | best general plan + doc understanding |
| Gemini Vision | commercial VLM | No | API/cloud terms | strong multimodal reasoning |
| Claude Vision | commercial VLM | No | API/cloud terms | docs + reasoning with images |
| Qwen2.5-VL / Qwen-VL | open weights VLM | Yes | check model card for exact terms | self-host plan understanding |
| Pixtral 12B | open weights VLM | Yes | check HF model card | on-prem doc/diagram understanding |
| SAM 2 | segmentation | Yes | Meta research license | pre-processing / masks |
| TripoSR | image-to-3D | Yes | MIT | fast 3D preview |

> Always verify exact licensing on the model card/repo before production use.

---

## Recommended choices for this project (practical)

Given this repo’s “blueprint sync” context, you likely want **(A) blueprint understanding and extraction** + **(B) structured representation and change tracking** more than raw text-to-3D.

### Recommendation 1 (fastest path, highest quality): GPT-4o for VLM + LLM
- Use GPT-4o for:
  - blueprint image understanding,
  - extraction to JSON,
  - reasoning about changes.
- Pair with OCR (PaddleOCR/Tesseract or cloud OCR) for dimension reliability.
- Store:
  - OCR text + boxes,
  - extracted entities,
  - model-generated reasoning traces as audit notes (not as source of truth).

**Citations:** OpenAI vision docs [`platform.openai.com/docs/guides/images-vision`](https://platform.openai.com/docs/guides/images-vision).

### Recommendation 2 (self-hosted option): Pixtral 12B or Qwen2.5-VL
- Use for on-prem inference where data residency matters.
- Expect more engineering effort:
  - GPU sizing,
  - quantization,
  - evaluation harness on your blueprint corpus.

**Citations:** Pixtral announcement [`mistral.ai/news/pixtral-12b`](https://mistral.ai/news/pixtral-12b); Qwen-VL intro [`qwenlm.github.io/blog/qwen-vl/`](https://qwenlm.github.io/blog/qwen-vl/).

### Recommendation 3 (preprocessing): SAM 2 for mask generation
- Use to isolate:
  - title block vs drawing,
  - legends,
  - room regions,
  - symbol clusters.

**Citation:** SAM2 page [`ai.meta.com/research/sam2/`](https://ai.meta.com/research/sam2/).

### Recommendation 4 (CAD generation): LLM → CADQuery/OpenSCAD + verifier
- Prefer codegen into a parametric DSL you can unit-test.
- Add visual feedback loop (render → critique → patch).

**Citation (research pointer):** ASME CAD+LLM paper [`asmedigitalcollection.asme.org/mechanicaldesign/article/147/4/041710/1212251/Large-Language-Models-for-Computer-Aided-Design`](https://asmedigitalcollection.asme.org/mechanicaldesign/article/147/4/041710/1212251/Large-Language-Models-for-Computer-Aided-Design).

---

## Implementation notes (evaluation + safety)

1. **Build an evaluation set**: 20–100 representative blueprint pages (different standards, scans, languages).
2. Measure:
   - text extraction accuracy (dimensions/labels),
   - symbol classification accuracy,
   - topology correctness (room adjacency),
   - consistency checks (areas sum, door counts).
3. **Never trust a single model pass** for dimensions:
   - cross-check OCR vs VLM,
   - run constraint solvers,
   - require human review for critical outputs.

---

## Links / further reading

- OpenAI vision guide: [`platform.openai.com/docs/guides/images-vision`](https://platform.openai.com/docs/guides/images-vision)
- GPT-4o model page: [`platform.openai.com/docs/models/gpt-4o`](https://platform.openai.com/docs/models/gpt-4o)
- Qwen-VL intro: [`qwenlm.github.io/blog/qwen-vl/`](https://qwenlm.github.io/blog/qwen-vl/)
- Pixtral 12B: [`mistral.ai/news/pixtral-12b`](https://mistral.ai/news/pixtral-12b)
- Pixtral HF card: [`huggingface.co/mistralai/Pixtral-12B-2409`](https://huggingface.co/mistralai/Pixtral-12B-2409)
- Pixtral paper: [`arxiv.org/abs/2410.07073`](https://arxiv.org/abs/2410.07073)
- SAM2: [`ai.meta.com/research/sam2/`](https://ai.meta.com/research/sam2/)
- TripoSR (MIT): [`github.com/VAST-AI-Research/TripoSR`](https://github.com/VAST-AI-Research/TripoSR)
