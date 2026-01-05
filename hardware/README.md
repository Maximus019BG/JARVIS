# JARVIS TUI App

A futuristic Text User Interface (TUI) for controlling hardware operations.

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
- Settings menu with:
  - Customizable theme (primary, secondary, background colors).
  - Hardcoded system stats display.
  - Profile submenu for editing name and email.
- Modular design for easy addition of more buttons and menus.
- Futuristic styling with neon colors and animations.

## Installation

1. Install Python 3.8+.
2. Install dependencies: `pip install -r requirements.txt`
3. Run the app: `python app.py`

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

To add more screens, create a new screen file in `src/screens/`, import it in `app.py`, and add to `HardwareApp.SCREENS`.

To add widgets, place in `src/widgets/`.