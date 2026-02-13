"""Tests for blueprint parser module."""

from __future__ import annotations

import json
import pytest
from pathlib import Path

from core.blueprint.parser import (
    Blueprint,
    BlueprintParser,
    BlueprintType,
    ComponentSpec,
    Connection,
    Dimension,
    Material,
)


class TestDimension:
    """Tests for Dimension model."""

    def test_dimension_with_values(self) -> None:
        """Test dimension with explicit values."""
        dim = Dimension(length=100, width=50, height=25, unit="cm")
        assert dim.length == 100
        assert dim.width == 50
        assert dim.height == 25
        assert dim.unit == "cm"

    def test_dimension_default_unit(self) -> None:
        """Test dimension with default unit."""
        dim = Dimension(length=10, width=20, height=30)
        assert dim.unit == "mm"

    def test_dimension_serialization(self) -> None:
        """Test dimension serialization."""
        dim = Dimension(length=100, width=50, height=25)
        data = dim.model_dump()
        assert data["length"] == 100
        assert data["width"] == 50
        assert data["height"] == 25


class TestMaterial:
    """Tests for Material model."""

    def test_material_minimal(self) -> None:
        """Test material with minimal fields."""
        mat = Material(name="Steel")
        assert mat.name == "Steel"
        assert mat.type == "generic"
        assert mat.properties == {}

    def test_material_with_properties(self) -> None:
        """Test material with properties."""
        mat = Material(
            name="Aluminum",
            type="metal",
            properties={"conductivity": "high", "density": 2.7},
        )
        assert mat.name == "Aluminum"
        assert mat.type == "metal"
        assert mat.properties["conductivity"] == "high"
        assert mat.properties["density"] == 2.7


class TestComponentSpec:
    """Tests for ComponentSpec model."""

    def test_component_minimal(self) -> None:
        """Test minimal component spec."""
        comp = ComponentSpec(
            id="comp1",
            name="Base Plate",
        )
        assert comp.id == "comp1"
        assert comp.name == "Base Plate"
        assert comp.type == "generic"
        assert comp.children == []

    def test_component_with_dimensions(self) -> None:
        """Test component with dimensions."""
        comp = ComponentSpec(
            id="comp2",
            name="Box",
            type="box",
            dimensions=Dimension(length=100, width=50, height=25),
        )
        assert comp.dimensions is not None
        assert comp.dimensions.length == 100

    def test_component_with_children(self) -> None:
        """Test component with children."""
        comp = ComponentSpec(
            id="comp3",
            name="Assembly",
            type="assembly",
            children=["child1", "child2"],
        )
        assert len(comp.children) == 2
        assert "child1" in comp.children


class TestConnection:
    """Tests for Connection model."""

    def test_connection(self) -> None:
        """Test connection between components."""
        conn = Connection(
            from_id="comp1",
            to_id="comp2",
            type="bolt",
            properties={"torque": "10Nm"},
        )
        assert conn.from_id == "comp1"
        assert conn.to_id == "comp2"
        assert conn.type == "bolt"
        assert conn.properties["torque"] == "10Nm"


class TestBlueprint:
    """Tests for Blueprint model."""

    def test_blueprint_minimal(self) -> None:
        """Test minimal blueprint."""
        bp = Blueprint(name="Test Blueprint")
        assert bp.name == "Test Blueprint"
        assert bp.type == BlueprintType.PART
        assert bp.jarvis_version == "1.0"

    def test_blueprint_with_type(self) -> None:
        """Test blueprint with specific type."""
        bp = Blueprint(
            name="Building Design",
            type=BlueprintType.BUILDING,
        )
        assert bp.type == BlueprintType.BUILDING

    def test_blueprint_with_components(self) -> None:
        """Test blueprint with components."""
        bp = Blueprint(
            name="House",
            type=BlueprintType.BUILDING,
            components=[
                ComponentSpec(id="wall1", name="Wall 1", type="wall"),
                ComponentSpec(id="wall2", name="Wall 2", type="wall"),
            ],
        )
        assert len(bp.components) == 2
        assert bp.components[0].id == "wall1"

    def test_blueprint_with_connections(self) -> None:
        """Test blueprint with connections."""
        bp = Blueprint(
            name="Circuit",
            type=BlueprintType.CIRCUIT,
            components=[
                ComponentSpec(id="r1", name="Resistor 1", type="resistor"),
                ComponentSpec(id="c1", name="Capacitor 1", type="capacitor"),
            ],
            connections=[
                Connection(from_id="r1", to_id="c1", type="wire"),
            ],
        )
        assert len(bp.connections) == 1
        assert bp.connections[0].from_id == "r1"

    def test_blueprint_get_component(self) -> None:
        """Test getting component by ID."""
        bp = Blueprint(
            name="Test",
            components=[
                ComponentSpec(id="box1", name="Box 1"),
            ],
        )
        comp = bp.get_component("box1")
        assert comp is not None
        assert comp.name == "Box 1"

        assert bp.get_component("nonexistent") is None

    def test_blueprint_add_component(self) -> None:
        """Test adding component."""
        bp = Blueprint(name="Test")
        bp.add_component(ComponentSpec(id="new1", name="New Component"))

        assert len(bp.components) == 1
        assert bp.get_component("new1") is not None

    def test_blueprint_remove_component(self) -> None:
        """Test removing component."""
        bp = Blueprint(
            name="Test",
            components=[
                ComponentSpec(id="box1", name="Box 1"),
            ],
        )

        assert bp.remove_component("box1") is True
        assert len(bp.components) == 0
        assert bp.remove_component("nonexistent") is False

    def test_blueprint_compute_hash(self) -> None:
        """Test computing content hash."""
        bp = Blueprint(name="Test")
        hash1 = bp.compute_hash()

        assert len(hash1) == 16  # First 16 chars of SHA-256

        # Same content = same hash
        hash2 = bp.compute_hash()
        assert hash1 == hash2


class TestBlueprintParser:
    """Tests for BlueprintParser."""

    @pytest.fixture
    def parser(self) -> BlueprintParser:
        """Create a parser instance."""
        return BlueprintParser()

    @pytest.fixture
    def sample_blueprint_json(self) -> str:
        """Create sample blueprint JSON."""
        return json.dumps(
            {
                "jarvis_version": "1.0",
                "type": "part",
                "name": "Test Part",
                "description": "A test part",
                "components": [
                    {"id": "c1", "name": "Component 1", "type": "box"},
                ],
            }
        )

    def test_parser_creation(self, parser: BlueprintParser) -> None:
        """Test parser creation."""
        assert parser is not None

    def test_load_from_file(
        self, parser: BlueprintParser, tmp_path: Path
    ) -> None:
        """Test loading from file."""
        bp_file = tmp_path / "test.jarvis"
        bp_file.write_text(
            json.dumps(
                {
                    "name": "File Test",
                    "type": "part",
                    "components": [],
                }
            )
        )

        bp = parser.load(bp_file)
        assert bp.name == "File Test"

    def test_save_to_file(
        self, parser: BlueprintParser, tmp_path: Path
    ) -> None:
        """Test saving to file."""
        bp = Blueprint(name="Save Test")
        output_file = tmp_path / "output.jarvis"

        parser.save(bp, output_file)

        assert output_file.exists()
        loaded = parser.load(output_file)
        assert loaded.name == "Save Test"

    def test_parse_json_dict(
        self, parser: BlueprintParser
    ) -> None:
        """Test parsing dict."""
        data = {
            "name": "Test Part",
            "type": "part",
            "components": [
                {"id": "c1", "name": "Component 1", "type": "box"},
            ],
        }
        bp = parser.parse(data)
        assert bp.name == "Test Part"
        assert len(bp.components) == 1

    def test_to_json(self, parser: BlueprintParser) -> None:
        """Test converting to JSON via save/load roundtrip."""
        bp = Blueprint(
            name="JSON Test",
            components=[ComponentSpec(id="c1", name="Comp 1")],
        )

        # Test by saving and checking the file content
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".jarvis", delete=False) as f:
            parser.save(bp, f.name)
            with open(f.name) as rf:
                data = json.load(rf)
        
        assert data["name"] == "JSON Test"
        assert len(data["components"]) == 1

    def test_validate_valid_blueprint(self, parser: BlueprintParser) -> None:
        """Test validating valid blueprint."""
        bp = Blueprint(
            name="Valid",
            components=[ComponentSpec(id="c1", name="Comp 1")],
        )
        errors = parser.validate(bp)
        assert len(errors) == 0

    def test_validate_duplicate_ids(self, parser: BlueprintParser) -> None:
        """Test validation catches duplicate IDs."""
        bp = Blueprint(
            name="Duplicate IDs",
            components=[
                ComponentSpec(id="c1", name="Comp 1"),
                ComponentSpec(id="c1", name="Comp 2"),  # Duplicate
            ],
        )
        errors = parser.validate(bp)
        assert len(errors) > 0
        assert any("duplicate" in e.lower() for e in errors)

    def test_validate_invalid_connection(self, parser: BlueprintParser) -> None:
        """Test validation catches invalid connections."""
        bp = Blueprint(
            name="Bad Connection",
            components=[ComponentSpec(id="c1", name="Comp")],
            connections=[
                Connection(from_id="c1", to_id="nonexistent", type="bolt"),
            ],
        )
        errors = parser.validate(bp)
        assert len(errors) > 0
