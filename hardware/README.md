# JARVIS TUI App

A futuristic Text User Interface (TUI) for controlling hardware operations.

> ⚠️ **Build Tool Requirement**
>
> This repository does **not** support `pip install -r requirements.txt`.
> All dependency management is handled via **`uv`** using `pyproject.toml` and `uv.lock`.
>
> Attempts to install dependencies without `uv` may fail or produce inconsistent environments.


## Project Structure

```
hardware/
├── app.py              # Main entry point
├── styles.css          # CSS styling
├── requirements.txt    # Dependencies
├── README.md           # This file
└── src/
    ├── __init__.py
    ├── config.py       # Constants like stats and theme
    ├── screens/
    │   ├── __init__.py
    │   ├── main_menu.py
    │   ├── settings.py
    │   └── profile.py
    └── widgets/
        ├── __init__.py
        └── menu_button.py
```

## Features

- Main menu with buttons for Load Blueprint, Create Blueprint, Live Assistance, Settings, Smart Mode.
- Smart Mode: Interactive chat interface with Llama 3 3B AI model for intelligent assistance.
- Settings menu with:
  - Customizable theme (primary, secondary, background colors).
  - Hardcoded system stats display.
  - Profile submenu for editing name and email.
- Modular design for easy addition of more buttons and menus.
- Futuristic styling with neon colors and animations.

## Installation

1. Install Python 3.13+.
2. Install [uv](https://github.com/astral-sh/uv) for dependency management.
3. Install dependencies: `uv sync`
4. (Optional) Install Ollama for Smart Mode AI chat: Follow [Ollama installation](https://ollama.com/) and pull the model: `ollama pull llama3.2:3b`
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

Navigate with keyboard arrows and Enter. Use Tab to switch between elements.

## Extending

To add more buttons, edit the `menu_items` list in `src/screens/main_menu.py`.

To add more screens, use the generation script: `python generate_screen.py <screen_name>`, then import and add to `HardwareApp.SCREENS` in `app.py`.

Alternatively, create a new screen file in `src/screens/`, import it in `app.py`, and add to `HardwareApp.SCREENS`.

To add widgets, place in `src/widgets/`.

## Development with Roo

The Hardware Startup mode in Roo can assist with setting up, running, building, and extending the application. Use it for dependency management, code generation, and troubleshooting.