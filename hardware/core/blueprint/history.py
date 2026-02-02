"""Undo/redo command history for blueprint operations.

Implements the Command pattern for reversible operations.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Generic, TypeVar

T = TypeVar("T")


class Command(ABC):
    """Abstract base class for undoable commands.

    Each command encapsulates an action that can be executed and undone.
    """

    @property
    @abstractmethod
    def description(self) -> str:
        """Human-readable description of the command."""

    @abstractmethod
    def execute(self) -> bool:
        """Execute the command.

        Returns:
            True if execution succeeded, False otherwise.
        """

    @abstractmethod
    def undo(self) -> bool:
        """Undo the command.

        Returns:
            True if undo succeeded, False otherwise.
        """

    def redo(self) -> bool:
        """Redo the command (default: re-execute)."""
        return self.execute()


@dataclass
class TransformCommand(Command):
    """Command to transform a node."""

    node_id: str
    old_x: float
    old_y: float
    old_z: float
    new_x: float
    new_y: float
    new_z: float
    scene_graph: Any  # SceneGraph reference

    @property
    def description(self) -> str:
        return f"Move node {self.node_id}"

    def execute(self) -> bool:
        node = self.scene_graph.get_node(self.node_id)
        if node is None:
            return False
        node.transform.x = self.new_x
        node.transform.y = self.new_y
        node.transform.z = self.new_z
        return True

    def undo(self) -> bool:
        node = self.scene_graph.get_node(self.node_id)
        if node is None:
            return False
        node.transform.x = self.old_x
        node.transform.y = self.old_y
        node.transform.z = self.old_z
        return True


@dataclass
class RotateCommand(Command):
    """Command to rotate a node."""

    node_id: str
    old_rx: float
    old_ry: float
    old_rz: float
    new_rx: float
    new_ry: float
    new_rz: float
    scene_graph: Any

    @property
    def description(self) -> str:
        return f"Rotate node {self.node_id}"

    def execute(self) -> bool:
        node = self.scene_graph.get_node(self.node_id)
        if node is None:
            return False
        node.transform.rx = self.new_rx
        node.transform.ry = self.new_ry
        node.transform.rz = self.new_rz
        return True

    def undo(self) -> bool:
        node = self.scene_graph.get_node(self.node_id)
        if node is None:
            return False
        node.transform.rx = self.old_rx
        node.transform.ry = self.old_ry
        node.transform.rz = self.old_rz
        return True


@dataclass
class ScaleCommand(Command):
    """Command to scale a node."""

    node_id: str
    old_sx: float
    old_sy: float
    old_sz: float
    new_sx: float
    new_sy: float
    new_sz: float
    scene_graph: Any

    @property
    def description(self) -> str:
        return f"Scale node {self.node_id}"

    def execute(self) -> bool:
        node = self.scene_graph.get_node(self.node_id)
        if node is None:
            return False
        node.transform.sx = self.new_sx
        node.transform.sy = self.new_sy
        node.transform.sz = self.new_sz
        return True

    def undo(self) -> bool:
        node = self.scene_graph.get_node(self.node_id)
        if node is None:
            return False
        node.transform.sx = self.old_sx
        node.transform.sy = self.old_sy
        node.transform.sz = self.old_sz
        return True


@dataclass
class AddNodeCommand(Command):
    """Command to add a node to scene graph."""

    node_data: dict[str, Any]  # Serialized node data
    parent_id: str
    scene_graph: Any

    @property
    def description(self) -> str:
        return f"Add node {self.node_data.get('id', 'unknown')}"

    def execute(self) -> bool:
        from core.blueprint.scene_graph import SceneNode, Transform, BoundingBox

        try:
            node = SceneNode(
                id=self.node_data["id"],
                name=self.node_data.get("name", ""),
                component_id=self.node_data.get("component_id"),
                transform=Transform(**self.node_data.get("transform", {})),
                bounds=BoundingBox(**self.node_data.get("bounds", {})),
                visible=self.node_data.get("visible", True),
                locked=self.node_data.get("locked", False),
            )
            self.scene_graph.add_node(node, self.parent_id)
            return True
        except Exception:
            return False

    def undo(self) -> bool:
        return self.scene_graph.remove_node(self.node_data["id"])


@dataclass
class RemoveNodeCommand(Command):
    """Command to remove a node from scene graph."""

    node_id: str
    node_data: dict[str, Any] = field(default_factory=dict)
    parent_id: str = ""
    scene_graph: Any = None

    @property
    def description(self) -> str:
        return f"Remove node {self.node_id}"

    def execute(self) -> bool:
        node = self.scene_graph.get_node(self.node_id)
        if node is None:
            return False

        # Save node data for undo
        self.parent_id = node.parent.id if node.parent else "root"
        self.node_data = {
            "id": node.id,
            "name": node.name,
            "component_id": node.component_id,
            "transform": {
                "x": node.transform.x,
                "y": node.transform.y,
                "z": node.transform.z,
                "rx": node.transform.rx,
                "ry": node.transform.ry,
                "rz": node.transform.rz,
                "sx": node.transform.sx,
                "sy": node.transform.sy,
                "sz": node.transform.sz,
            },
            "bounds": {
                "min_x": node.bounds.min_x,
                "min_y": node.bounds.min_y,
                "min_z": node.bounds.min_z,
                "max_x": node.bounds.max_x,
                "max_y": node.bounds.max_y,
                "max_z": node.bounds.max_z,
            },
            "visible": node.visible,
            "locked": node.locked,
        }

        return self.scene_graph.remove_node(self.node_id)

    def undo(self) -> bool:
        add_cmd = AddNodeCommand(
            node_data=self.node_data,
            parent_id=self.parent_id,
            scene_graph=self.scene_graph,
        )
        return add_cmd.execute()


@dataclass
class CompositeCommand(Command):
    """Command that groups multiple commands."""

    commands: list[Command] = field(default_factory=list)
    _description: str = "Composite command"

    @property
    def description(self) -> str:
        return self._description

    def add(self, command: Command) -> None:
        """Add a command to the group."""
        self.commands.append(command)

    def execute(self) -> bool:
        for cmd in self.commands:
            if not cmd.execute():
                # Rollback executed commands
                idx = self.commands.index(cmd)
                for prev_cmd in reversed(self.commands[:idx]):
                    prev_cmd.undo()
                return False
        return True

    def undo(self) -> bool:
        for cmd in reversed(self.commands):
            if not cmd.undo():
                return False
        return True


@dataclass
class HistoryEntry:
    """Entry in the command history."""

    command: Command
    timestamp: datetime = field(default_factory=datetime.now)
    executed: bool = False


class CommandHistory:
    """Manages undo/redo history for commands.

    Usage:
        history = CommandHistory(max_size=100)
        history.execute(my_command)
        history.undo()
        history.redo()
    """

    def __init__(self, max_size: int = 100) -> None:
        """Initialize command history.

        Args:
            max_size: Maximum number of commands to store.
        """
        self._max_size = max_size
        self._undo_stack: list[HistoryEntry] = []
        self._redo_stack: list[HistoryEntry] = []

    @property
    def can_undo(self) -> bool:
        """Check if there are commands to undo."""
        return len(self._undo_stack) > 0

    @property
    def can_redo(self) -> bool:
        """Check if there are commands to redo."""
        return len(self._redo_stack) > 0

    @property
    def undo_description(self) -> str | None:
        """Get description of next command to undo."""
        if self._undo_stack:
            return self._undo_stack[-1].command.description
        return None

    @property
    def redo_description(self) -> str | None:
        """Get description of next command to redo."""
        if self._redo_stack:
            return self._redo_stack[-1].command.description
        return None

    def execute(self, command: Command) -> bool:
        """Execute a command and add to history.

        Args:
            command: Command to execute.

        Returns:
            True if execution succeeded.
        """
        if command.execute():
            entry = HistoryEntry(command=command, executed=True)
            self._undo_stack.append(entry)

            # Clear redo stack (new action invalidates redo history)
            self._redo_stack.clear()

            # Trim if exceeding max size
            while len(self._undo_stack) > self._max_size:
                self._undo_stack.pop(0)

            return True
        return False

    def undo(self) -> bool:
        """Undo the last command.

        Returns:
            True if undo succeeded.
        """
        if not self._undo_stack:
            return False

        entry = self._undo_stack.pop()
        if entry.command.undo():
            self._redo_stack.append(entry)
            return True
        else:
            # Failed to undo, put back on stack
            self._undo_stack.append(entry)
            return False

    def redo(self) -> bool:
        """Redo the last undone command.

        Returns:
            True if redo succeeded.
        """
        if not self._redo_stack:
            return False

        entry = self._redo_stack.pop()
        if entry.command.redo():
            self._undo_stack.append(entry)
            return True
        else:
            # Failed to redo, put back on stack
            self._redo_stack.append(entry)
            return False

    def clear(self) -> None:
        """Clear all history."""
        self._undo_stack.clear()
        self._redo_stack.clear()

    def get_undo_history(self, limit: int = 10) -> list[str]:
        """Get descriptions of recent undo-able commands."""
        return [
            entry.command.description
            for entry in reversed(self._undo_stack[-limit:])
        ]

    def get_redo_history(self, limit: int = 10) -> list[str]:
        """Get descriptions of redo-able commands."""
        return [
            entry.command.description
            for entry in reversed(self._redo_stack[-limit:])
        ]
