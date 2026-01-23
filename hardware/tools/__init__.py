# Tools package for hardware app functionalities

from .sync_tool import SyncTool
from .send_blueprint_tool import SendBlueprintTool
from .update_blueprint_tool import UpdateBlueprintTool
from .sync_config_tool import SyncConfigTool
from .sync_queue_tool import SyncQueueTool
from .sync_status_tool import SyncStatusTool
from .resolve_conflict_tool import ResolveConflictTool
from .execute_code_tool import ExecuteCodeTool
from .web_search_tool import WebSearchTool, FetchWebpageTool
from .summarize_tool import SummarizeTool, ExtractKeyPointsTool
from .shell_tool import ShellCommandTool, ListDirectoryTool
from .memory_tools import RememberTool, RecallTool, ForgetTool, MemoryStatsTool

__all__ = [
    # Sync tools
    'SyncTool',
    'SendBlueprintTool',
    'UpdateBlueprintTool',
    'SyncConfigTool',
    'SyncQueueTool',
    'SyncStatusTool',
    'ResolveConflictTool',
    # Code execution
    'ExecuteCodeTool',
    # Web tools
    'WebSearchTool',
    'FetchWebpageTool',
    # Text tools
    'SummarizeTool',
    'ExtractKeyPointsTool',
    # Shell tools
    'ShellCommandTool',
    'ListDirectoryTool',
    # Memory tools
    'RememberTool',
    'RecallTool',
    'ForgetTool',
    'MemoryStatsTool',
]

# Sync tools registry
SYNC_TOOLS = [
    SyncTool(),
    SendBlueprintTool(),
    UpdateBlueprintTool(),
    SyncConfigTool(),
    SyncQueueTool(),
    SyncStatusTool(),
    ResolveConflictTool()
]

# Agent tools registry (for use with the multi-agent system)
AGENT_TOOLS = [
    ExecuteCodeTool(),
    WebSearchTool(),
    FetchWebpageTool(),
    SummarizeTool(),
    ExtractKeyPointsTool(),
    ShellCommandTool(),
    ListDirectoryTool(),
    RememberTool(),
    RecallTool(),
    ForgetTool(),
    MemoryStatsTool(),
]