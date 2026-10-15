# 🧠 JARVIS
### Job Acceleration Reference Visual Interface System

> “Your personal Agentic workspace assistant.”

JARVIS is a **hardware–software hybrid system** designed to augment human productivity at the workstation.  
Built on a **Raspberry Pi 5** with a **camera** and **projector**, JARVIS combines **AI vision**, **voice interaction**, and **workflow automation** to create a truly intelligent, context-aware workbench assistant.

---

## 🚀 Overview

JARVIS transforms an ordinary workspace into a **smart, interactive environment** that helps engineers, makers, and creators accelerate their work.  
Whether you’re prototyping hardware, writing firmware, or managing project workflows — JARVIS assists through **visual guidance**, **automation**, and **AI reasoning**.

---

## 💡 Core Features

### 🧠 Contextual Awareness
- Object recognition: Identify components, tools, and parts on the workbench.  
- Spatial memory: Remember where items were last seen.  
- Gesture interaction: Activate, select, or highlight using simple hand movements.  
- Multimodal understanding: Combine voice + gesture + camera input for seamless control.

### 🎙️ Natural Language & Voice Interface
- Full voice interaction (speech recognition + TTS).  
- “Ask and point” mode — e.g., *“Show me the pinout of that chip”* while pointing.  
- Conversational AI for design, debugging, or workflow help.

### 🤖 Agent Collaboration
- Communicate with other AI agents or APIs (ChatGPT, Copilot, HuggingFace).  
- Delegate complex tasks: *“JARVIS, ask Copilot to generate code for a DHT22 sensor.”*  
- Multi-agent orchestration for teamwork between specialized AIs.

---

## 🧰 Developer & Engineer Productivity

### 🔍 On-the-Fly Documentation
- Auto-detect components and display datasheets, pinouts, or schematics.  
- Project relevant wiring diagrams directly onto your workbench.

### 💻 Code Assistance
- Integrate with VS Code or IDEs via API.  
- Generate, debug, and upload firmware automatically.  
- Explain serial logs or compiler errors with natural language.

### ⚙️ Workflow Automation
- Deep integration with **n8n** for low-code task automation.  
- Automate actions like:
  - Uploading code to devices  
  - Sending project update emails  
  - Logging time in Google Sheets or Notion  
  - Scheduling via Google Calendar

---

## 🔧 Hardware Augmentation

### 📽️ Projection Overlay
- Visual guidance: wire connections, alignment grids, and measurements.  
- Step-by-step assembly projections.  
- Highlight workspace “safety zones” or active areas.

### 📷 Vision & Recognition
- QR code and text recognition (OCR).  
- Component classification (resistor, IC, etc.).  
- Workspace monitoring and alerts (motion, smoke, temperature).

### 🌐 IoT Integration
- Connect to smart plugs, lights, and sensors.  
- Read environmental data (temperature, humidity, air quality).  
- Execute voice commands like *“Turn on the soldering lamp.”*

---

## ☁️ Connectivity & Collaboration

- **Google / Microsoft Integration**: Calendar, Drive, Tasks, and Sheets.  
- **Remote Monitoring**: Securely stream your workspace camera feed.  
- **Collaboration Tools**:
  - Project remote teammate’s video feed or sketches.  
  - Real-time annotation and virtual whiteboard projection.

---

## 🧩 Tech Stack

What the repository runs today. The map is in [`docs/architecture.md`](docs/architecture.md).

| Part | Stack |
|-----------|-------------------|
| Terminal agent, Pi vision, worker (`tui/`) | Bun, TypeScript, Vercel AI SDK (Anthropic, OpenAI, Google, any OpenAI-compatible provider), OpenTUI |
| Web app + API (`web/`) | Next.js 16, Drizzle ORM, Postgres, Better Auth |
| Phone app (`mobile/`) | Expo 54, React Native |
| Vision | ONNX Runtime: hand tracking and a gesture classifier trained in `models/` (PyTorch, `uv`) |
| Voice | Wake word, speaker verification, transcription and speech through the web gateway |
| Automations | Canvas, runner and triggers in `web/`; agent steps run on your machine via `jarvis work` |
| Deploy | Kubernetes (kustomize overlays), nginx, Postgres |
| Hardware | Raspberry Pi 5, camera, projector |

---

## 🧱 Future Roadmap

- [ ] Enhanced 3D projection mapping  
- [ ] Multi-user collaboration support  
- [ ] Adaptive learning (workspace usage patterns)  
- [ ] Edge AI for faster local inference  

---

## 🛠️ Getting Started

### Requirements
- Raspberry Pi 5  
- Pi Camera or compatible USB camera  
- Mini projector (HD or higher)  
- Microphone + speaker  
- Internet connectivity

### Setup

- The `jarvis` CLI: [`tui/README.md`](tui/README.md). Web app and API: [`web/README.md`](web/README.md).
  Phone app: [`mobile/README.md`](mobile/README.md). Cluster: [`k8s/README.md`](k8s/README.md).
- Working on the code, as a person or an agent: start with [`AGENTS.md`](AGENTS.md).

> ⚠️ **Python is only used in `models/`** (gesture model training), and only through **`uv`**
> (`pyproject.toml` + `uv.lock`). `pip install -r requirements.txt` is not supported.