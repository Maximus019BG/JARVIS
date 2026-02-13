import json
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional


class OfflineQueue:
    """Manages offline operation queue"""

    QUEUE_PATH = Path("data/offline_queue.json")

    def __init__(self, max_size: int = 100):
        self.max_size = max_size
        self.queue = self._load_queue()

    def _load_queue(self) -> List[Dict]:
        """Load queue from file"""
        if self.QUEUE_PATH.exists():
            with open(self.QUEUE_PATH, "r") as f:
                return json.load(f)
        return []

    def _save_queue(self):
        """Save queue to file"""
        self.QUEUE_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(self.QUEUE_PATH, "w") as f:
            json.dump(self.queue, f, indent=2)

    def add(self, operation_type: str, data: Dict):
        """Add operation to queue"""
        if len(self.queue) >= self.max_size:
            self.queue.pop(0)

        self.queue.append(
            {
                "type": operation_type,
                "data": data,
                "timestamp": datetime.utcnow().isoformat(),
            }
        )
        self._save_queue()

    def pop(self) -> Optional[Dict]:
        """Pop oldest operation from queue"""
        if self.queue:
            operation = self.queue.pop(0)
            self._save_queue()
            return operation
        return None

    def is_empty(self) -> bool:
        """Check if queue is empty"""
        return len(self.queue) == 0

    def clear(self):
        """Clear all operations from queue"""
        self.queue = []
        self._save_queue()
