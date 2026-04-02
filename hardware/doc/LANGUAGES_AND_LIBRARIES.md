# Programming Languages & Libraries Reference

> **Linked from**: [PLATFORM.md](./PLATFORM.md)

This document catalogs all programming languages, libraries, and dependencies used across the JARVIS project with detailed usage information.

---

## Table of Contents

1. [Python (Hardware App)](#python-hardware-app)
2. [TypeScript/JavaScript (Web App)](#typescriptjavascript-web-app)
3. [TypeScript/React Native (Mobile App)](#typescriptexpo-react-native-mobile-app)
4. [C++ (Legacy Hardware)](#c-legacy-hardware)
5. [System Dependencies](#system-dependencies)

---

## Python (Hardware App)

**Location**: `hardware/`

### Core Dependencies

| Library | Version | Purpose | Files Used |
|---------|---------|---------|------------|
| **ollama** | >=0.4.0 | Local LLM inference (gemma3:1b, etc.) | `core/llm/gemma_wrapper.py` |
| **google-generativeai** | >=0.8.0 | Google Gemini API wrapper | `core/llm/google_ai_wrapper.py` |
| **groq** | >=0.9.0 | Groq cloud LLM API | `core/llm/groq_wrapper.py` |
| **aiohttp** | >=3.11.0 | Async HTTP client | `core/sync/*.py`, `core/http_client.py` |
| **aiofiles** | >=24.1.0 | Async file I/O | `core/blueprint/*.py`, tools |
| **pyttsx3** | >=2.98 | Offline TTS engine | `core/tts/engine.py` |
| **gTTS** | >=2.5.0 | Google TTS (online) | `core/tts/engine.py` |
| **pygame** | >=2.6.0 | Audio playback for gTTS | `core/tts/engine.py` |
| **python-dotenv** | >=1.0.1 | Environment variable loading | `config/config.py` |
| **pydantic** | >=2.10.0 | Configuration validation | `config/config.py` |
| **pydantic-settings** | >=2.7.0 | Settings management | `config/config.py` |
| **cryptography** | >=43.0.0 | Encryption/security | `core/security/*.py` |
| **numpy** | >=2.0.0 | Numerical operations, array handling | `core/vision/camera_capture.py`, `core/blueprint/drawing/*.py` |
| **jinja2** | >=3.1.0 | Templating | Email templates, blueprints |
| **orjson** | >=3.10.0 | Fast JSON serialization | `core/sync/*.py` |
| **opencv-python-headless** | >=4.9.0 | Image processing, camera | `core/vision/camera_capture.py` (fallback), `legacy/` |
| **textual** | >=8.0.0 | TUI framework | `core/tui/app.py` |

### Optional (Pi-Specific)

| Library | Purpose | Files Used |
|---------|---------|------------|
| **picamera2** | Raspberry Pi camera interface | `core/vision/camera_capture.py` |
| **mediapipe** | Hand gesture detection | `core/vision/gesture_recognizer.py` |

### Development Dependencies

| Library | Version | Purpose |
|---------|---------|---------|
| **pyinstaller** | >=6.17.0 | Build executable |
| **ruff** | >=0.8.0 | Linting & formatting |
| **pytest** | >=8.3.0 | Testing framework |
| **pytest-asyncio** | >=0.24.0 | Async test support |
| **pytest-mock** | >=3.14.0 | Mocking |
| **pytest-cov** | >=6.0.0 | Coverage reporting |

### Python Usage by Module

#### Core Application
- **`app.py`**: Main entry point, TUI launcher
- **`config/config.py`**: Pydantic settings, configuration management

#### LLM Integration (`core/llm/`)
- **`gemma_wrapper.py`**: Ollama local model wrapper
- **`google_ai_wrapper.py`**: Google Gemini API integration
- **`groq_wrapper.py`**: Groq API integration
- **`provider_factory.py`**: Factory pattern for LLM providers

#### Multi-Agent System (`core/agents/`)
- **OrchestratorAgent**: Task orchestration
- **CoderAgent**: Code generation
- **PlannerAgent**: Planning/scheduling
- **BlueprintAgent**: Blueprint management
- **CriticAgent**: Code review
- **ResearcherAgent**: Web research
- **MemoryAgent**: Semantic memory

#### Tool System (`core/` & `tools/`)
- **`tool_registry.py`**: Tool registration & discovery
- **`tool_execution.py`**: Tool execution engine
- **Blueprint tools**: `create_blueprint_tool.py`, `load_blueprint_tool.py`, etc.
- **Data tools**: `list_data_tool.py`, `search_data_tool.py`
- **File tools**: `read_file_tool.py`, `write_file_tool.py` (with security)

#### Blueprint Engine (`core/blueprint/`)
- **`engine.py`**: Main blueprint processing
- **`scene_graph.py`**: Scene graph data structure
- **`renderer.py`**: Frame rendering
- **`parser.py`**: Blueprint JSON parsing
- **`selection.py`**: Object selection
- **`transforms.py`**: Geometric transforms
- **`drawing/canvas.py`**: Drawing canvas
- **`drawing/tools.py`**: Drawing tools (line, rect, circle, etc.)
- **`drawing/primitives.py`**: Geometric primitives
- **`drawing/grid.py`**: Grid system

#### Vision System (`core/vision/`)
- **`camera_capture.py`**: Camera abstraction (Picamera2/OpenCV)
- **`gesture_recognizer.py`**: Hand gesture detection
- **`gesture_events.py`**: Gesture event handling
- **`vision_config.py`**: Vision configuration

#### Memory System (`core/memory/`)
- **`unified_memory_manager.py`**: Unified memory (semantic + episodic)
- **`semantic_memory.py`**: Semantic search
- **`episodic_memory.py`**: Episode storage

#### Sync System (`core/sync/`)
- **`sync_manager.py`**: Cloud sync coordination
- **`sync_factory.py`**: Sync provider factory
- **`offline_queue.py`**: Offline operation queue
- **`conflict_resolver.py`**: Sync conflict resolution

#### TTS (`core/tts/`)
- **`engine.py`**: TTS engine abstraction (pyttsx3, gTTS, disabled)

#### Security (`core/security/`)
- **`security_manager.py`**: File access security
- **`secure_storage.py`**: Encrypted storage

---

## TypeScript/JavaScript (Web App)

**Location**: `web/`

### Dependencies

| Library | Version | Purpose | Usage |
|---------|---------|---------|-------|
| **next** | ^16.1.6 | React framework | Full app framework |
| **react** | ^19.2.4 | UI library | Components |
| **react-dom** | ^19.2.4 | React DOM | Rendering |
| **@tanstack/react-query** | ^5.90.20 | Data fetching | API state management |
| **axios** | ^1.13.4 | HTTP client | API calls |
| **zod** | ^4.3.6 | Schema validation | Form validation |
| **drizzle-orm** | ^0.45.1 | ORM | Database operations |
| **postgres** | ^3.4.8 | PostgreSQL driver | Database |
| **better-auth** | ^1.4.18 | Authentication | Auth framework |
| **jsonwebtoken** | ^9.0.3 | JWT handling | Token management |
| **jwt-decode** | ^4.0.0 | JWT decoding | Token parsing |
| **resend** | ^6.9.1 | Email sending | Transactional emails |
| **react-hook-form** | ^7.71.1 | Form handling | Form state |
| **@hookform/resolvers** | ^5.2.2 | Form resolvers | Zod integration |
| **zustand** | ^5.0.11 | State management | Client state |
| **reactflow** | ^11.11.4 | Flow/automation canvas | Automation editor |
| **recharts** | 3.7.0 | Charts | Data visualization |
| **lucide-react** | ^0.562.0 | Icons | UI icons |
| **tailwind-merge** | ^3.4.0 | Tailwind utility | Class merging |
| **clsx** | ^2.1.1 | ClassName utility | Conditional classes |
| **motion** | ^12.31.1 | Animations | Framer Motion replacement |
| **date-fns** | ^4.1.0 | Date utilities | Date formatting |
| **nanoid** | ^5.1.6 | ID generation | Unique IDs |
| **qrcode** | ^1.5.4 | QR code generation | Device pairing |
| **nuqs** | ^2.8.8 | URL state | URL parameter state |

### UI Components (Radix UI)

| Library | Purpose |
|---------|---------|
| **@radix-ui/react-dialog** | Modal dialogs |
| **@radix-ui/react-dropdown-menu** | Dropdown menus |
| **@radix-ui/react-select** | Select dropdowns |
| **@radix-ui/react-tooltip** | Tooltips |
| **@radix-ui/react-checkbox** | Checkboxes |
| **@radix-ui/react-switch** | Toggle switches |
| **@radix-ui/react-slider** | Sliders |
| **@radix-ui/react-tabs** | Tabs |
| **@radix-ui/react-accordion** | Accordions |
| **@radix-ui/react-alert-dialog** | Alert dialogs |
| **@radix-ui/react-avatar** | Avatars |
| **@radix-ui/react-progress** | Progress bars |
| **@radix-ui/react-scroll-area** | Scroll areas |
| **@radix-ui/react-popover** | Popovers |
| **@radix-ui/react-collapsible** | Collapsible sections |
| **@radix-ui/react-context-menu** | Context menus |
| **@radix-ui/react-separator** | Separators |
| **@radix-ui/react-toggle** | Toggle buttons |
| **@radix-ui/react-toggle-group** | Toggle groups |
| **@radix-ui/react-hover-card** | Hover cards |
| **@radix-ui/react-aspect-ratio** | Aspect ratio |
| **@radix-ui/react-menubar** | Menu bars |
| **@radix-ui/react-navigation-menu** | Navigation menus |
| **@radix-ui/react-radio-group** | Radio groups |
| **@radix-ui/react-label** | Labels |

### Development Dependencies

| Library | Version | Purpose |
|---------|---------|---------|
| **typescript** | ^5.9.3 | Type safety |
| **eslint** | ^9.39.2 | Linting |
| **prettier** | ^3.8.1 | Formatting |
| **tailwindcss** | ^4.1.18 | Styling |
| **postcss** | ^8.5.6 | CSS processing |
| **drizzle-kit** | ^0.31.8 | DB migrations |
| **jest** | ^29.7.0 | Testing |
| **ts-jest** | ^29.4.6 | TypeScript Jest |
| **babel-jest** | ^30.2.0 | Babel Jest |

### TypeScript Usage by Module

#### API Routes (`src/app/api/`)
- Authentication: `src/app/api/auth/[...all]/`
- Workstation: `src/app/api/workstation/`
- Blueprint: `src/app/api/workstation/blueprint/`
- Automation: `src/app/api/workstation/automation/`
- Mobile: `src/app/api/mobile/`
- Automations webhook: `src/app/api/automations/webhook/`

#### Database (`src/server/db/`)
- **Schemas**: `src/server/db/schemas/*.ts` (user, blueprint, automation, device, etc.)
- **Queries**: `src/server/db/queries/*.ts`

#### Components (`src/components/`)
- Auth: `src/components/auth/*.tsx`
- Dashboard: `src/components/dashboard/*.tsx`
- Blueprints: `src/components/blueprints/*.tsx`
- Automations: `src/components/automations/*.tsx`
- UI: `src/components/ui/*.tsx` (Radix-based)

#### Lib (`src/lib/`)
- Authentication: `src/lib/auth.ts`, `src/lib/auth-client.ts`
- API clients: `src/lib/api/*.ts`
- Utilities: `src/lib/utils.ts`
- Validation: `src/lib/validation/*.ts`

---

## TypeScript/Expo (Mobile App)

**Location**: `mobile/`

### Dependencies

| Library | Version | Purpose |
|---------|---------|---------|
| **expo** | 54.0.12 | Framework |
| **expo-router** | 6.0.10 | File-based routing |
| **react-native** | 0.81.4 | React Native |
| **react** | 19.1.0 | UI library |
| **react-dom** | 19.1.0 | DOM rendering |
| **expo-secure-store** | 15.0.7 | Secure storage |
| **expo-auth-session** | 7.0.8 | Auth |
| **expo-notifications** | 0.32.12 | Push notifications |
| **expo-device** | 8.0.9 | Device info |
| **expo-font** | 14.0.8 | Custom fonts |
| **expo-image** | 3.0.8 | Image handling |
| **expo-haptics** | 15.0.7 | Haptic feedback |
| **expo-keep-awake** | 15.0.7 | Keep screen on |
| **expo-linking** | 8.0.8 | Deep linking |
| **expo-splash-screen** | 31.0.10 | Splash screen |
| **expo-status-bar** | 3.0.7 | Status bar |
| **expo-system-ui** | 6.0.7 | System UI |
| **expo-web-browser** | 15.0.8 | Web browser |
| **expo-build-properties** | 1.0.9 | Build config |
| **expo-dev-client** | 6.0.13 | Dev client |
| **@react-navigation/native** | 7.1.8 | Navigation |
| **@react-navigation/bottom-tabs** | 7.4.0 | Tab navigation |
| **@react-navigation/elements** | 2.6.3 | Navigation elements |
| **react-native-gesture-handler** | 2.28.0 | Gestures |
| **react-native-reanimated** | 4.1.1 | Animations |
| **react-native-safe-area-context** | 5.6.0 | Safe area |
| **react-native-screens** | 4.16.0 | Native screens |
| **react-native-webview** | 13.15.0 | WebView |
| **react-native-worklets** | 0.5.1 | Worklets |
| **firebase** | ^12.3.0 | Firebase SDK |

### Mobile Usage by Module

#### App Routes (`mobile/app/`)
- **`_layout.tsx`**: Root layout
- **`(tabs)/*`**: Tab-based screens

#### Components (`mobile/components/`)
- UI components
- Themed components
- Parallax scrolling

#### Hooks (`mobile/hooks/`)
- Theme color
- Color scheme
- Notifications

---

## C++ (Legacy Hardware)

**Location**: `legacy/hardware/JARVIS/`

### Dependencies (System)

| Library | Purpose |
|---------|---------|
| **libcamera** | Camera stack |
| **rpicam-apps** | Raspberry Pi camera apps |
| **imx500-all** | IMX500 NPU support |
| **TensorFlow Lite** | ML inference |
| **OpenCV** | Image processing |

### C++ Modules

#### Core (`src/`)
- **`main.cpp`**: Main application entry point
- **`camera.cpp`**: Camera abstraction
- **`pipeline.cpp`**: Processing pipeline
- **`sketch_pad.cpp`**: Drawing/sketching
- **`renderer.cpp`**: Frame rendering

#### Hand Detection (`src/`)
- **`hand_detector.cpp`**: Base hand detection
- **`hand_detector_mediapipe.cpp`**: MediaPipe detection
- **`hand_detector_imx500.cpp`**: IMX500 NPU detection
- **`hand_detector_tflite.cpp`**: TensorFlow Lite detection
- **`hand_detector_hybrid.cpp`**: Hybrid detection
- **`hand_detector_simd.cpp`**: SIMD optimized

#### Utilities (`src/`)
- **`http_client.cpp`**: HTTP client
- **`crypto.cpp`**: Encryption
- **`draw_ticker.cpp`**: Drawing ticker

---

## System Dependencies

### Raspberry Pi OS

```bash
# Camera
sudo apt install -y libcamera-dev rpicam-apps imx500-all libcap-dev

# Python build
sudo apt install -y python3-dev python3-pip

# Audio (TTS)
sudo apt install -y espeak ffmpeg
```

### Build Tools

| Tool | Purpose |
|------|---------|
| **uv** | Python package manager |
| **pnpm** | Node.js package manager (web) |
| **PyInstaller** | Python executable builder |
| **Next.js** | React framework builder |

---

## Quick Reference

### Technology Stack Summary

| Component | Language | Key Libraries |
|-----------|----------|---------------|
| **Hardware App** | Python 3.11+ | ollama, google-generativeai, pydantic, textual, opencv, numpy |
| **Web Backend** | TypeScript | next, drizzle-orm, postgres, better-auth |
| **Web Frontend** | TypeScript/React | react, zustand, radix-ui, tailwindcss |
| **Mobile App** | TypeScript/React Native | expo, react-native, firebase |
| **Legacy C++** | C++ | libcamera, opencv, tensorflow-lite |

### Import Patterns

```python
# Hardware Python
from core.llm import GemmaWrapper, GoogleAIWrapper
from core.vision import CameraCapture, GestureRecognizer
from core.blueprint import BlueprintEngine, Renderer
from config.config import get_config
```

```typescript
// Web TypeScript
import { Button } from "@/components/ui/button"
import { useQuery } from "@tanstack/react-query"
import { drizzle } from "@/server/db"
```

```typescript
// Mobile TypeScript
import { useColorScheme } from "hooks/use-color-scheme"
import { Stack } from "expo-router"
```
