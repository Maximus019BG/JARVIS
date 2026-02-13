"""Blueprint Agent - Creates blueprints for parts and buildings.

The blueprint agent specializes in:
- Designing physical parts and components
- Creating building/structure layouts
- Generating .jarvis blueprint files
- System architecture design
- Hardware specifications
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

from app_logging.logger import get_logger
from core.agents.base_agent import AgentResponse, AgentRole, BaseAgent

logger = get_logger(__name__)


class BlueprintType(str, Enum):
    """Types of blueprints that can be created."""

    PART = "part"  # Individual component/part
    ASSEMBLY = "assembly"  # Collection of parts
    BUILDING = "building"  # Structure/building design
    SYSTEM = "system"  # System architecture
    CIRCUIT = "circuit"  # Electrical circuit
    MECHANISM = "mechanism"  # Mechanical mechanism


@dataclass
class Dimension:
    """Represents dimensions of a part or structure."""

    length: float
    width: float
    height: float
    unit: str = "mm"  # mm, cm, m, in, ft


@dataclass
class Material:
    """Material specification."""

    name: str
    type: str  # metal, plastic, wood, composite, etc.
    properties: dict[str, Any] = field(default_factory=dict)


@dataclass
class BlueprintSpec:
    """Complete blueprint specification."""

    name: str
    blueprint_type: BlueprintType
    description: str
    dimensions: Dimension | None = None
    materials: list[Material] = field(default_factory=list)
    components: list[dict[str, Any]] = field(default_factory=list)
    connections: list[dict[str, Any]] = field(default_factory=list)
    specifications: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)


class BlueprintAgent(BaseAgent):
    """Agent specialized in creating blueprints for parts and buildings.

    Creates detailed .jarvis blueprint files that can be used for
    manufacturing, construction, or further design work.
    """

    def __init__(
        self,
        model_name: str | None = None,
        temperature: float = 0.6,
        blueprint_dir: str = "data/blueprints",
    ):
        super().__init__(model_name=model_name, temperature=temperature)
        self.blueprint_dir = Path(blueprint_dir)
        self.blueprint_dir.mkdir(parents=True, exist_ok=True)

    @property
    def role(self) -> AgentRole:
        return AgentRole.BLUEPRINT

    @property
    def system_prompt(self) -> str:
        return """You are an expert design engineer and architect. Your responsibilities:

1. DESIGN: Create detailed blueprints for parts, assemblies, and buildings
2. SPECIFY: Define precise dimensions, materials, and specifications
3. DOCUMENT: Generate comprehensive .jarvis blueprint files
4. VALIDATE: Ensure designs are manufacturable/buildable
5. OPTIMIZE: Balance function, cost, and feasibility

DESIGN PRINCIPLES:
- Form follows function
- Design for manufacturability (DFM)
- Consider material properties and constraints
- Include tolerances where applicable
- Think about assembly and maintenance
- Account for safety factors
- Document all assumptions

BLUEPRINT OUTPUT FORMAT (.jarvis):
```json
{
  "jarvis_version": "1.0",
  "type": "part|assembly|building|system",
  "name": "Component Name",
  "description": "What this blueprint represents",
  "created": "ISO timestamp",
  "dimensions": {
    "length": 100,
    "width": 50,
    "height": 25,
    "unit": "mm"
  },
  "materials": [
    {
      "name": "Material Name",
      "type": "metal|plastic|wood|composite",
      "properties": {}
    }
  ],
  "components": [
    {
      "id": "part_001",
      "name": "Sub-component",
      "quantity": 1,
      "specifications": {}
    }
  ],
  "connections": [
    {
      "from": "part_001",
      "to": "part_002",
      "type": "bolt|weld|glue|snap"
    }
  ],
  "specifications": {},
  "notes": []
}
```

Be precise with measurements. When unsure, provide reasonable estimates with notes."""

    async def create_blueprint(
        self,
        description: str,
        blueprint_type: BlueprintType = BlueprintType.PART,
        constraints: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> AgentResponse:
        """Create a blueprint based on description.

        Args:
            description: What to design.
            blueprint_type: Type of blueprint.
            constraints: Design constraints (size, material, cost).
            context: Additional context.

        Returns:
            AgentResponse with the blueprint design.
        """
        prompt = f"""Design a {blueprint_type.value} blueprint for:

DESCRIPTION: {description}
"""

        if constraints:
            constraint_str = "\n".join(f"- {k}: {v}" for k, v in constraints.items())
            prompt += f"\n\nCONSTRAINTS:\n{constraint_str}"

        prompt += """

Provide:
1. A complete .jarvis blueprint in JSON format
2. Design rationale
3. Material justification
4. Manufacturing/construction notes
5. Estimated cost range (if applicable)
"""

        return await self.process(prompt, context)

    async def design_part(
        self,
        part_name: str,
        function: str,
        dimensions: dict[str, float] | None = None,
        material_preference: str | None = None,
    ) -> AgentResponse:
        """Design a specific part.

        Args:
            part_name: Name of the part.
            function: What the part does.
            dimensions: Target dimensions (optional).
            material_preference: Preferred material (optional).

        Returns:
            AgentResponse with part blueprint.
        """
        prompt = f"""Design a part:

NAME: {part_name}
FUNCTION: {function}
"""

        if dimensions:
            dim_str = ", ".join(f"{k}: {v}" for k, v in dimensions.items())
            prompt += f"TARGET DIMENSIONS: {dim_str}\n"

        if material_preference:
            prompt += f"PREFERRED MATERIAL: {material_preference}\n"

        prompt += """
Create a detailed .jarvis blueprint including:
- Precise dimensions with tolerances
- Material specification with justification
- Surface finish requirements
- Any special manufacturing notes
"""

        return await self.process(prompt)

    async def design_building(
        self,
        building_type: str,
        requirements: list[str],
        site_constraints: dict[str, Any] | None = None,
    ) -> AgentResponse:
        """Design a building or structure.

        Args:
            building_type: Type of building (house, shed, garage, etc).
            requirements: List of requirements.
            site_constraints: Site-specific constraints.

        Returns:
            AgentResponse with building blueprint.
        """
        reqs_str = "\n".join(f"- {r}" for r in requirements)

        prompt = f"""Design a {building_type}:

REQUIREMENTS:
{reqs_str}
"""

        if site_constraints:
            site_str = "\n".join(f"- {k}: {v}" for k, v in site_constraints.items())
            prompt += f"\n\nSITE CONSTRAINTS:\n{site_str}"

        prompt += """

Provide a .jarvis blueprint including:
- Overall dimensions and layout
- Structural components
- Material specifications
- Foundation requirements
- Utility considerations (electrical, plumbing)
- Estimated material quantities
"""

        return await self.process(prompt)

    async def design_assembly(
        self,
        assembly_name: str,
        components: list[str],
        function: str,
    ) -> AgentResponse:
        """Design an assembly of multiple parts.

        Args:
            assembly_name: Name of the assembly.
            components: List of component descriptions.
            function: What the assembly does.

        Returns:
            AgentResponse with assembly blueprint.
        """
        comps_str = "\n".join(f"- {c}" for c in components)

        prompt = f"""Design an assembly:

NAME: {assembly_name}
FUNCTION: {function}

COMPONENTS:
{comps_str}

Provide a .jarvis blueprint including:
- Individual part specifications
- Assembly sequence
- Connection types (bolts, welds, adhesive, etc.)
- Alignment and tolerance requirements
- Exploded view description
"""

        return await self.process(prompt)

    def save_blueprint(
        self,
        name: str,
        blueprint_data: dict[str, Any],
    ) -> Path:
        """Save a blueprint to a .jarvis file.

        Args:
            name: Blueprint name (used as filename).
            blueprint_data: The blueprint data to save.

        Returns:
            Path to the saved file.
        """
        # Ensure .jarvis extension
        filename = f"{name}.jarvis" if not name.endswith(".jarvis") else name
        filepath = self.blueprint_dir / filename

        # Add metadata if not present
        if "jarvis_version" not in blueprint_data:
            blueprint_data["jarvis_version"] = "1.0"

        from datetime import datetime

        if "created" not in blueprint_data:
            blueprint_data["created"] = datetime.now().isoformat()

        filepath.write_text(json.dumps(blueprint_data, indent=2), encoding="utf-8")
        logger.info(f"Saved blueprint to {filepath}")

        return filepath

    def load_blueprint(self, name: str) -> dict[str, Any] | None:
        """Load a blueprint from a .jarvis file.

        Args:
            name: Blueprint name.

        Returns:
            Blueprint data or None if not found.
        """
        filename = f"{name}.jarvis" if not name.endswith(".jarvis") else name
        filepath = self.blueprint_dir / filename

        if not filepath.exists():
            logger.warning(f"Blueprint not found: {filepath}")
            return None

        return json.loads(filepath.read_text(encoding="utf-8"))

    def list_blueprints(self) -> list[str]:
        """List all available blueprints.

        Returns:
            List of blueprint names.
        """
        return [f.stem for f in self.blueprint_dir.glob("*.jarvis")]

    async def analyze_blueprint(
        self,
        blueprint_data: dict[str, Any],
    ) -> AgentResponse:
        """Analyze an existing blueprint.

        Args:
            blueprint_data: The blueprint to analyze.

        Returns:
            AgentResponse with analysis.
        """
        prompt = f"""Analyze this blueprint:

```json
{json.dumps(blueprint_data, indent=2)}
```

Provide:
1. Design assessment
2. Potential issues or improvements
3. Manufacturing feasibility
4. Cost optimization suggestions
5. Safety considerations
"""

        return await self.process(prompt)
