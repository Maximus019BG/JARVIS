"""Tool to view system statistics."""

from __future__ import annotations

# Standard library imports
import re
import subprocess

# Local application imports
from core.base_tool import BaseTool, ToolResult


class ViewStatsTool(BaseTool):
    """Tool for viewing system stats."""

    @property
    def name(self) -> str:
        return "view_stats"

    @property
    def description(self) -> str:
        return "Displays current system statistics."

    def _get_cpu_usage(self) -> str:
        """Get CPU usage percentage."""
        try:
            result = subprocess.run(
                ["top", "-bn1"], capture_output=True, text=True, timeout=10
            )
            # Parse CPU usage from top output
            match = re.search(r"%Cpu\(s\):\s+([\d.]+)", result.stdout)
            if match:
                return f"{match.group(1)}%"
        except (subprocess.SubprocessError, subprocess.TimeoutExpired):
            pass
        return "N/A"

    def _get_memory_usage(self) -> str:
        """Get memory usage."""
        try:
            result = subprocess.run(["free", "-h"], capture_output=True, text=True)
            lines = result.stdout.strip().split("\n")
            if len(lines) >= 2:
                mem_line = lines[1].split()
                if len(mem_line) >= 7:
                    used = mem_line[2]
                    total = mem_line[0]
                    return f"{used}/{total}"
        except subprocess.SubprocessError:
            pass
        return "N/A"

    def _get_temperature(self) -> str:
        """Get system temperature."""
        try:
            # Try to read from thermal zones
            with open("/sys/class/thermal/thermal_zone0/temp", "r") as f:
                temp_milli = int(f.read().strip())
                temp_c = temp_milli / 1000
                return f"{temp_c:.1f}°C"
        except (FileNotFoundError, ValueError, IOError):
            pass
        return "N/A"

    def _get_uptime(self) -> str:
        """Get system uptime."""
        try:
            result = subprocess.run(["uptime", "-p"], capture_output=True, text=True)
            return result.stdout.strip()
        except subprocess.SubprocessError:
            pass
        return "N/A"

    def execute(self, **kwargs) -> ToolResult:
        """Execute the view stats tool."""

        stats = self.get_stats_dict()
        result = "System Statistics:\n"
        for key, value in stats.items():
            result += f"- {key}: {value}\n"
        return ToolResult.ok_result(result.strip())

    def get_stats_dict(self) -> dict[str, str]:
        """Get stats as dictionary."""
        return {
            "CPU Usage": self._get_cpu_usage(),
            "Memory Usage": self._get_memory_usage(),
            "Temperature": self._get_temperature(),
            "Uptime": self._get_uptime(),
        }

    def get_schema(self) -> dict:
        return super().get_schema()
