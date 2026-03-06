# JARVIS Hardware App

A chat-driven hardware app using a natural language interface with AI and tools for controlling hardware operations.

> ⚠️ **Build Tool Requirement**
>
> This repository does **not** support `pip install -r requirements.txt`.
> All dependency management is handled via **`uv`** using `pyproject.toml` and `uv.lock`.
>
> Attempts to install dependencies without `uv` may fail or produce inconsistent environments.
> You need to have `libcap-dev`



## Project Structure

```
hardware/
├── app.py              # Main entry point - chat handler
├── pyproject.toml      # Project dependencies and configuration
├── uv.lock             # Locked dependencies
├── README.md           # This file
├── build.sh            # Build script for executable
├── core/               # Core modules
│   ├── chat_handler.py # Handles chat interactions
│   ├── tool_registry.py# Registry for tools
│   └── ...
├── tools/              # Available tools
│   ├── help_tool.py
│   ├── load_blueprint_tool.py
│   └── ...
├── data/               # Data storage
│   └── blueprints/
└── logging/            # Logging directory
```

## Features

- Natural language chat interface for hardware control.
- Modular tool system for various operations:
  - Help: Display available commands
  - Load/Save Blueprints: Manage hardware blueprints
  - Live Assistance: Real-time help
  - Smart Mode: AI-powered assistance
  - Theme and Profile management
- Extensible architecture for adding new tools.

## Installation

1. Install Python 3.13+.
2. Install [uv](https://github.com/astral-sh/uv) for dependency management.
3. Install dependencies: `uv sync`
4. (Optional) Install Ollama for Smart Mode AI chat: Follow [Ollama installation](https://ollama.com/) and pull the model: `ollama pull gemma3:1b`
5. Run the app: `python app.py`

## Code Quality

Ensure code quality with Ruff linting and formatting:

1. Install dev dependencies: `uv sync --group dev`
2. Check linting: `ruff check .`
3. Format code: `ruff format .`

## Building Executable

To build a standalone executable:

1. Run the build script: `./build.sh`
2. The executable will be in `build/jarvis`
3. Run it: `./build/jarvis`

Note: Requires PyInstaller. The build folder contains the output.

## Usage

Start the app with `python app.py` and interact via natural language commands. Type 'help' to see available tools.

## Switching hardware sync target (localhost ↔ domain)

Use a single env var in `hardware/.env`:

- `SYNC_API_BASE_URL=http://localhost:3000` (local server)
- `SYNC_API_BASE_URL=https://your-domain.com` (remote server)

The app reads this value on startup via config and uses it for all sync APIs.
Legacy `JARVIS_SYNC_SERVER_URL` is still accepted when `SYNC_API_BASE_URL` is not set.

## Extending

To add new tools, create a new tool class in `tools/`, inheriting from the base tool class, and register it in `app.py`.

See existing tools for examples.

## Development with Roo

The Hardware Startup mode in Roo can assist with setting up, running, building, and extending the application. Use it for dependency management, code generation, and troubleshooting.