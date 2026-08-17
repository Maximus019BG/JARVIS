"""CLI commands for JARVIS configuration.

Fallback when AI assistant is unavailable.

Usage:
    jarvis-config show              # Show current LLM config
    jarvis-config set --api-key KEY # Set API key
    jarvis-config set --model MODEL # Set model
    jarvis-config set --url URL     # Set base URL
"""

from __future__ import annotations

import argparse
import sys

from core.data_utils import load_llm_config, save_llm_config


AVAILABLE_MODELS = [
    "kimi-k2.5",              # Latest multimodal model (recommended)
    "kimi-k2-turbo-preview",  # Fast turbo model
    "kimi-k2-thinking",       # Reasoning/thinking model
    "moonshot-v1-auto",       # Auto-select context length
    "moonshot-v1-8k",         # Legacy 8K context
    "moonshot-v1-32k",        # Legacy 32K context
    "moonshot-v1-128k",       # Legacy 128K context
]


def cmd_show(args: argparse.Namespace) -> int:
    """Show current LLM configuration."""
    config = load_llm_config()

    # Mask API key
    api_key = config["api_key"]
    if len(api_key) > 8:
        masked = api_key[:4] + "***" + api_key[-4:]
    elif api_key:
        masked = "***"
    else:
        masked = "(not set)"

    print("LLM Configuration:")
    print(f"  API Key:  {masked}")
    print(f"  Model:    {config['model']}")
    print(f"  Base URL: {config['base_url']}")
    return 0


def cmd_set(args: argparse.Namespace) -> int:
    """Set LLM configuration values."""
    config = load_llm_config()
    updated = []

    if args.api_key:
        config["api_key"] = args.api_key
        updated.append("api_key")

    if args.model:
        if args.model not in AVAILABLE_MODELS:
            print(f"Error: Invalid model. Available: {', '.join(AVAILABLE_MODELS)}")
            return 1
        config["model"] = args.model
        updated.append("model")

    if args.url:
        if not args.url.startswith(("http://", "https://")):
            print("Error: URL must start with http:// or https://")
            return 1
        config["base_url"] = args.url
        updated.append("base_url")

    if not updated:
        print("No changes specified. Use --api-key, --model, or --url")
        return 1

    save_llm_config(config)
    print(f"Updated: {', '.join(updated)}")
    print("Restart JARVIS to apply changes.")
    return 0


def main() -> int:
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        prog="jarvis-config",
        description="JARVIS LLM configuration (use when AI is unavailable)",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # show command
    subparsers.add_parser("show", help="Show current LLM configuration")

    # set command
    set_parser = subparsers.add_parser("set", help="Set LLM configuration")
    set_parser.add_argument("--api-key", "-k", help="Moonshot API key")
    set_parser.add_argument(
        "--model",
        "-m",
        choices=AVAILABLE_MODELS,
        help="Model to use",
    )
    set_parser.add_argument("--url", "-u", help="Custom base URL")

    args = parser.parse_args()

    if args.command == "show":
        return cmd_show(args)
    elif args.command == "set":
        return cmd_set(args)

    return 0


if __name__ == "__main__":
    sys.exit(main())
