from __future__ import annotations

from core.tool_registry import ToolRegistry
from tools.apply_theme_tool import ApplyThemeTool
from tools.create_blueprint_tool import CreateBlueprintTool
from tools.load_blueprint_tool import LoadBlueprintTool


def _params(schema: dict) -> dict:
    assert schema["type"] == "function"
    assert "function" in schema
    assert "parameters" in schema["function"]
    return schema["function"]["parameters"]


def test_schema_apply_theme_from_schema_parameters() -> None:
    tool = ApplyThemeTool()
    schema = tool.get_schema()

    assert schema["function"]["name"] == "apply_theme"

    params = _params(schema)
    assert params["type"] == "object"

    props = params["properties"]
    assert set(props.keys()) >= {"primary", "secondary", "background"}
    assert props["primary"]["type"] == "string"

    # No required fields: tool allows updating any subset.
    assert params.get("required") == []


def test_schema_load_blueprint_requires_name() -> None:
    tool = LoadBlueprintTool()
    schema = tool.get_schema()

    assert schema["function"]["name"] == "load_blueprint"
    params = _params(schema)

    assert "blueprint_name" in params["properties"]
    assert params["required"] == ["blueprint_name"]


def test_schema_create_blueprint_baseline() -> None:
    tool = CreateBlueprintTool()
    schema = tool.get_schema()

    assert schema["function"]["name"] == "create_blueprint"
    params = _params(schema)

    assert "blueprint_name" in params["properties"]
    assert "theme" in params["properties"]
    assert "profile" in params["properties"]
    assert params["required"] == ["blueprint_name"]


def test_tool_registry_get_tool_schemas_deterministic_and_complete() -> None:
    registry = ToolRegistry()
    registry.register_tool(CreateBlueprintTool())
    registry.register_tool(ApplyThemeTool())
    registry.register_tool(LoadBlueprintTool())

    schemas = registry.get_tool_schemas()
    assert isinstance(schemas, list)

    # Deterministic order is alphabetical by tool name.
    assert [s["function"]["name"] for s in schemas] == [
        "apply_theme",
        "create_blueprint",
        "load_blueprint",
    ]

    # Spot-check parameters exist.
    apply_theme_params = _params(schemas[0])
    assert set(apply_theme_params["properties"].keys()) >= {
        "primary",
        "secondary",
        "background",
    }
