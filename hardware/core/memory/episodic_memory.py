"""Episodic memory for tracking experiences, events, and temporal context.

Provides memory of events and experiences with:
- Temporal ordering and relationships
- Event sequences and narratives
- Context reconstruction
- Time-based retrieval
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from pathlib import Path
from typing import Any

from app_logging.logger import get_logger

logger = get_logger(__name__)


class EventType(str, Enum):
    """Types of events that can be recorded."""

    CONVERSATION = "conversation"  # Chat interactions
    TASK_START = "task_start"  # Beginning of a task
    TASK_COMPLETE = "task_complete"  # Task completion
    TASK_FAILED = "task_failed"  # Task failure
    DECISION = "decision"  # A decision was made
    DISCOVERY = "discovery"  # Something was learned/discovered
    ERROR = "error"  # An error occurred
    USER_FEEDBACK = "user_feedback"  # User provided feedback
    SYSTEM = "system"  # System events
    CUSTOM = "custom"  # Custom event type


@dataclass
class Episode:
    """A single episode/event in memory."""

    id: str
    event_type: EventType
    description: str
    timestamp: datetime = field(default_factory=datetime.now)

    # Context
    context: dict[str, Any] = field(default_factory=dict)
    participants: list[str] = field(
        default_factory=list
    )  # e.g., ["user", "coder_agent"]
    location: str = ""  # Virtual location/context

    # Relationships
    preceding_event_id: str | None = None
    following_event_id: str | None = None
    related_event_ids: list[str] = field(default_factory=list)

    # Outcome
    outcome: str = ""
    success: bool | None = None
    importance: float = 0.5  # 0.0 to 1.0

    # Additional data
    metadata: dict[str, Any] = field(default_factory=dict)
    tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "event_type": self.event_type.value,
            "description": self.description,
            "timestamp": self.timestamp.isoformat(),
            "context": self.context,
            "participants": self.participants,
            "location": self.location,
            "preceding_event_id": self.preceding_event_id,
            "following_event_id": self.following_event_id,
            "related_event_ids": self.related_event_ids,
            "outcome": self.outcome,
            "success": self.success,
            "importance": self.importance,
            "metadata": self.metadata,
            "tags": self.tags,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Episode:
        """Create from dictionary."""
        return cls(
            id=data["id"],
            event_type=EventType(data["event_type"]),
            description=data["description"],
            timestamp=datetime.fromisoformat(data["timestamp"])
            if data.get("timestamp")
            else datetime.now(),
            context=data.get("context", {}),
            participants=data.get("participants", []),
            location=data.get("location", ""),
            preceding_event_id=data.get("preceding_event_id"),
            following_event_id=data.get("following_event_id"),
            related_event_ids=data.get("related_event_ids", []),
            outcome=data.get("outcome", ""),
            success=data.get("success"),
            importance=data.get("importance", 0.5),
            metadata=data.get("metadata", {}),
            tags=data.get("tags", []),
        )


@dataclass
class Session:
    """A session containing a sequence of episodes."""

    id: str
    name: str
    start_time: datetime = field(default_factory=datetime.now)
    end_time: datetime | None = None
    episode_ids: list[str] = field(default_factory=list)
    summary: str = ""
    goals: list[str] = field(default_factory=list)
    outcomes: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "name": self.name,
            "start_time": self.start_time.isoformat(),
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "episode_ids": self.episode_ids,
            "summary": self.summary,
            "goals": self.goals,
            "outcomes": self.outcomes,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Session:
        """Create from dictionary."""
        return cls(
            id=data["id"],
            name=data["name"],
            start_time=datetime.fromisoformat(data["start_time"])
            if data.get("start_time")
            else datetime.now(),
            end_time=datetime.fromisoformat(data["end_time"])
            if data.get("end_time")
            else None,
            episode_ids=data.get("episode_ids", []),
            summary=data.get("summary", ""),
            goals=data.get("goals", []),
            outcomes=data.get("outcomes", []),
            metadata=data.get("metadata", {}),
        )

    @property
    def duration(self) -> timedelta | None:
        """Get session duration."""
        if self.end_time:
            return self.end_time - self.start_time
        return datetime.now() - self.start_time

    @property
    def is_active(self) -> bool:
        """Check if session is still active."""
        return self.end_time is None


class EpisodicMemory:
    """Manages episodic (event-based) memory.

    Tracks events and experiences over time with:
    - Temporal relationships between events
    - Session-based organization
    - Time-range queries
    - Event sequence reconstruction
    """

    def __init__(
        self,
        storage_path: str = "data/memory/episodes",
        max_episodes: int = 5000,
    ):
        self.storage_path = Path(storage_path)
        self.storage_path.mkdir(parents=True, exist_ok=True)

        self.max_episodes = max_episodes

        # Storage
        self._episodes: dict[str, Episode] = {}
        self._sessions: dict[str, Session] = {}

        # Current session
        self._current_session: Session | None = None
        self._last_episode_id: str | None = None

        # Counter for IDs
        self._episode_counter = 0
        self._session_counter = 0

        # Load existing data
        self._load()

    def _generate_episode_id(self) -> str:
        """Generate unique episode ID."""
        self._episode_counter += 1
        return f"ep_{datetime.now().strftime('%Y%m%d')}_{self._episode_counter:06d}"

    def _generate_session_id(self) -> str:
        """Generate unique session ID."""
        self._session_counter += 1
        return f"sess_{datetime.now().strftime('%Y%m%d')}_{self._session_counter:04d}"

    def start_session(
        self,
        name: str = "",
        goals: list[str] | None = None,
    ) -> Session:
        """Start a new session.

        Args:
            name: Session name/description.
            goals: Goals for this session.

        Returns:
            The new Session.
        """
        # End current session if exists
        if self._current_session and self._current_session.is_active:
            self.end_session()

        session_id = self._generate_session_id()
        session = Session(
            id=session_id,
            name=name or f"Session {session_id}",
            goals=goals or [],
        )

        self._sessions[session_id] = session
        self._current_session = session

        logger.info(f"Started session: {session.name}")
        self._save()

        return session

    def end_session(
        self, summary: str = "", outcomes: list[str] | None = None
    ) -> Session | None:
        """End the current session.

        Args:
            summary: Summary of the session.
            outcomes: Outcomes achieved.

        Returns:
            The ended Session or None.
        """
        if not self._current_session:
            return None

        self._current_session.end_time = datetime.now()
        self._current_session.summary = summary
        self._current_session.outcomes = outcomes or []

        ended_session = self._current_session
        self._current_session = None
        self._last_episode_id = None

        logger.info(f"Ended session: {ended_session.name}")
        self._save()

        return ended_session

    def get_current_session(self) -> Session | None:
        """Get the current active session."""
        return self._current_session

    def record(
        self,
        description: str,
        event_type: EventType = EventType.CUSTOM,
        context: dict[str, Any] | None = None,
        participants: list[str] | None = None,
        outcome: str = "",
        success: bool | None = None,
        importance: float = 0.5,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Episode:
        """Record a new episode/event.

        Args:
            description: What happened.
            event_type: Type of event.
            context: Contextual information.
            participants: Who was involved.
            outcome: What was the result.
            success: Was it successful.
            importance: How important (0.0-1.0).
            tags: Tags for categorization.
            metadata: Additional data.

        Returns:
            The created Episode.
        """
        episode_id = self._generate_episode_id()

        episode = Episode(
            id=episode_id,
            event_type=event_type,
            description=description,
            context=context or {},
            participants=participants or [],
            outcome=outcome,
            success=success,
            importance=importance,
            tags=tags or [],
            metadata=metadata or {},
            preceding_event_id=self._last_episode_id,
        )

        # Link to previous episode
        if self._last_episode_id and self._last_episode_id in self._episodes:
            self._episodes[self._last_episode_id].following_event_id = episode_id

        # Store episode
        self._episodes[episode_id] = episode
        self._last_episode_id = episode_id

        # Add to current session
        if self._current_session:
            self._current_session.episode_ids.append(episode_id)

        # Cleanup if over limit
        if len(self._episodes) > self.max_episodes:
            self._cleanup_old_episodes()

        self._save()
        logger.debug(f"Recorded episode: {description[:50]}...")

        return episode

    def recall_recent(self, count: int = 10) -> list[Episode]:
        """Recall the most recent episodes.

        Args:
            count: Number of episodes to return.

        Returns:
            List of recent episodes.
        """
        episodes = sorted(
            self._episodes.values(),
            key=lambda e: e.timestamp,
            reverse=True,
        )
        return episodes[:count]

    def recall_by_timerange(
        self,
        start: datetime,
        end: datetime | None = None,
    ) -> list[Episode]:
        """Recall episodes within a time range.

        Args:
            start: Start of time range.
            end: End of time range (default: now).

        Returns:
            List of episodes in the range.
        """
        end = end or datetime.now()

        episodes = [
            ep for ep in self._episodes.values() if start <= ep.timestamp <= end
        ]

        return sorted(episodes, key=lambda e: e.timestamp)

    def recall_by_type(
        self,
        event_type: EventType,
        limit: int = 20,
    ) -> list[Episode]:
        """Recall episodes by event type.

        Args:
            event_type: Type to filter by.
            limit: Maximum results.

        Returns:
            List of matching episodes.
        """
        episodes = [ep for ep in self._episodes.values() if ep.event_type == event_type]

        episodes.sort(key=lambda e: e.timestamp, reverse=True)
        return episodes[:limit]

    def recall_by_participant(
        self,
        participant: str,
        limit: int = 20,
    ) -> list[Episode]:
        """Recall episodes involving a participant.

        Args:
            participant: Participant to search for.
            limit: Maximum results.

        Returns:
            List of matching episodes.
        """
        episodes = [
            ep for ep in self._episodes.values() if participant in ep.participants
        ]

        episodes.sort(key=lambda e: e.timestamp, reverse=True)
        return episodes[:limit]

    def recall_sequence(
        self,
        episode_id: str,
        before: int = 5,
        after: int = 5,
    ) -> list[Episode]:
        """Recall a sequence of episodes around a given episode.

        Args:
            episode_id: Center episode ID.
            before: Episodes before.
            after: Episodes after.

        Returns:
            Sequence of episodes.
        """
        if episode_id not in self._episodes:
            return []

        center_episode = self._episodes[episode_id]
        sequence = [center_episode]

        # Get preceding episodes
        current_id = center_episode.preceding_event_id
        for _ in range(before):
            if current_id and current_id in self._episodes:
                sequence.insert(0, self._episodes[current_id])
                current_id = self._episodes[current_id].preceding_event_id
            else:
                break

        # Get following episodes
        current_id = center_episode.following_event_id
        for _ in range(after):
            if current_id and current_id in self._episodes:
                sequence.append(self._episodes[current_id])
                current_id = self._episodes[current_id].following_event_id
            else:
                break

        return sequence

    def search(
        self,
        query: str,
        limit: int = 10,
    ) -> list[Episode]:
        """Search episodes by description content.

        Args:
            query: Search query.
            limit: Maximum results.

        Returns:
            List of matching episodes.
        """
        query_lower = query.lower()
        matches = []

        for episode in self._episodes.values():
            score = 0
            if query_lower in episode.description.lower():
                score += 2
            if query_lower in episode.outcome.lower():
                score += 1
            if any(query_lower in tag.lower() for tag in episode.tags):
                score += 1

            if score > 0:
                matches.append((episode, score))

        matches.sort(key=lambda x: (x[1], x[0].timestamp), reverse=True)
        return [ep for ep, _ in matches[:limit]]

    def get_session_episodes(self, session_id: str) -> list[Episode]:
        """Get all episodes for a session.

        Args:
            session_id: Session ID.

        Returns:
            List of episodes in the session.
        """
        if session_id not in self._sessions:
            return []

        session = self._sessions[session_id]
        episodes = [
            self._episodes[ep_id]
            for ep_id in session.episode_ids
            if ep_id in self._episodes
        ]

        return sorted(episodes, key=lambda e: e.timestamp)

    def get_session_summary(self, session_id: str) -> str:
        """Get a summary of a session.

        Args:
            session_id: Session ID.

        Returns:
            Summary string.
        """
        if session_id not in self._sessions:
            return "Session not found."

        session = self._sessions[session_id]
        episodes = self.get_session_episodes(session_id)

        summary_parts = [
            f"## Session: {session.name}",
            f"Duration: {session.duration}",
            f"Episodes: {len(episodes)}",
        ]

        if session.goals:
            summary_parts.append(f"Goals: {', '.join(session.goals)}")

        if session.outcomes:
            summary_parts.append(f"Outcomes: {', '.join(session.outcomes)}")

        if episodes:
            summary_parts.append("\n### Key Events:")
            # Get important events
            important = sorted(
                [e for e in episodes if e.importance >= 0.6],
                key=lambda e: e.importance,
                reverse=True,
            )[:5]

            for ep in important:
                status = "✓" if ep.success else "✗" if ep.success is False else "○"
                summary_parts.append(f"- {status} {ep.description[:80]}")

        return "\n".join(summary_parts)

    def get_today_summary(self) -> str:
        """Get a summary of today's episodes.

        Returns:
            Summary string.
        """
        today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        episodes = self.recall_by_timerange(today_start)

        if not episodes:
            return "No events recorded today."

        summary_parts = [
            f"## Today's Activity ({len(episodes)} events)",
            "",
        ]

        # Group by event type
        by_type: dict[EventType, list[Episode]] = {}
        for ep in episodes:
            if ep.event_type not in by_type:
                by_type[ep.event_type] = []
            by_type[ep.event_type].append(ep)

        for event_type, eps in by_type.items():
            summary_parts.append(f"### {event_type.value.title()} ({len(eps)})")
            for ep in eps[:3]:  # Show top 3
                summary_parts.append(f"- {ep.description[:60]}")
            if len(eps) > 3:
                summary_parts.append(f"  ... and {len(eps) - 3} more")
            summary_parts.append("")

        return "\n".join(summary_parts)

    def _cleanup_old_episodes(self) -> None:
        """Remove old, low-importance episodes."""
        if len(self._episodes) <= self.max_episodes:
            return

        # Sort by importance and age
        scored = [
            (
                ep_id,
                ep.importance * 0.5
                + (1 - min(1.0, (datetime.now() - ep.timestamp).days / 30)) * 0.5,
            )
            for ep_id, ep in self._episodes.items()
        ]
        scored.sort(key=lambda x: x[1])

        # Remove lowest scored
        to_remove = len(self._episodes) - self.max_episodes
        for ep_id, _ in scored[:to_remove]:
            del self._episodes[ep_id]
            logger.debug(f"Cleaned up old episode: {ep_id}")

    def _save(self) -> None:
        """Save to disk."""
        try:
            data = {
                "version": "1.0",
                "saved_at": datetime.now().isoformat(),
                "episode_counter": self._episode_counter,
                "session_counter": self._session_counter,
                "current_session_id": self._current_session.id
                if self._current_session
                else None,
                "last_episode_id": self._last_episode_id,
                "episodes": [ep.to_dict() for ep in self._episodes.values()],
                "sessions": [s.to_dict() for s in self._sessions.values()],
            }

            file_path = self.storage_path / "episodic_memory.json"
            file_path.write_text(json.dumps(data, indent=2), encoding="utf-8")

        except Exception as e:
            logger.error(f"Failed to save episodic memory: {e}")

    def _load(self) -> None:
        """Load from disk."""
        file_path = self.storage_path / "episodic_memory.json"

        if not file_path.exists():
            return

        try:
            data = json.loads(file_path.read_text(encoding="utf-8"))

            self._episode_counter = data.get("episode_counter", 0)
            self._session_counter = data.get("session_counter", 0)
            self._last_episode_id = data.get("last_episode_id")

            for ep_data in data.get("episodes", []):
                episode = Episode.from_dict(ep_data)
                self._episodes[episode.id] = episode

            for sess_data in data.get("sessions", []):
                session = Session.from_dict(sess_data)
                self._sessions[session.id] = session

            # Restore current session if was active
            current_session_id = data.get("current_session_id")
            if current_session_id and current_session_id in self._sessions:
                session = self._sessions[current_session_id]
                if session.is_active:
                    self._current_session = session

            logger.info(
                f"Loaded {len(self._episodes)} episodes, {len(self._sessions)} sessions"
            )

        except Exception as e:
            logger.error(f"Failed to load episodic memory: {e}")

    def get_stats(self) -> dict[str, Any]:
        """Get episodic memory statistics."""
        return {
            "total_episodes": len(self._episodes),
            "total_sessions": len(self._sessions),
            "current_session": self._current_session.name
            if self._current_session
            else None,
            "by_type": {
                et.value: sum(1 for e in self._episodes.values() if e.event_type == et)
                for et in EventType
            },
        }
