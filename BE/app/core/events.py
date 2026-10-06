from abc import ABC, abstractmethod
import asyncio
import logging
from typing import Dict, List, Optional

from app.schemas.event import SystemEvent

logger = logging.getLogger(__name__)


class BaseEventBus(ABC):
    """
    Abstract EventBus interface.
    Decouples business logic / publishers from the underlying messaging infrastructure.
    Can be seamlessly swapped with Redis Pub/Sub without modifying application call-sites.
    """

    @abstractmethod
    async def publish(self, event: SystemEvent) -> None:
        """Publish an event to all active subscribers."""
        pass

    @abstractmethod
    async def subscribe(self, user_id: str) -> asyncio.Queue:
        """Create and register a subscription queue for a user."""
        pass

    @abstractmethod
    async def unsubscribe(self, user_id: str, queue: asyncio.Queue) -> None:
        """Remove a subscription queue and release resources."""
        pass


class InMemoryEventBus(BaseEventBus):
    """
    In-memory event bus implementation using bounded asyncio.Queue per subscriber.

    Key Features:
    - Connection limit per user (default: 5 connections, oldest closed when exceeded).
    - Bounded subscriber queue (default: 100 items). Drops oldest event when full (never blocks publisher).
    - Monotonically increasing sequential event ID.
    - Safe subscriber cleanup with zero memory leak.
    """

    def __init__(self, max_connections_per_user: int = 5, queue_maxsize: int = 100):
        self.max_connections_per_user = max_connections_per_user
        self.queue_maxsize = queue_maxsize
        self._subscribers: Dict[str, List[asyncio.Queue]] = {}
        self._event_counter: int = 0
        self._lock: Optional[asyncio.Lock] = None

    def _get_lock(self) -> asyncio.Lock:
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    async def subscribe(self, user_id: str) -> asyncio.Queue:
        lock = self._get_lock()
        async with lock:
            if user_id not in self._subscribers:
                self._subscribers[user_id] = []

            user_queues = self._subscribers[user_id]

            # Enforce connection limit: close oldest connection if threshold reached
            if len(user_queues) >= self.max_connections_per_user:
                oldest_queue = user_queues.pop(0)
                try:
                    # Put sentinel None to signal closure to the client generator
                    oldest_queue.put_nowait(None)
                except (asyncio.QueueFull, Exception):
                    pass

            new_queue: asyncio.Queue = asyncio.Queue(maxsize=self.queue_maxsize)
            user_queues.append(new_queue)
            logger.info(
                f"User '{user_id}' subscribed. Active connections for user: {len(user_queues)}"
            )
            return new_queue

    async def unsubscribe(self, user_id: str, queue: asyncio.Queue) -> None:
        lock = self._get_lock()
        async with lock:
            if user_id in self._subscribers:
                user_queues = self._subscribers[user_id]
                if queue in user_queues:
                    user_queues.remove(queue)
                if not user_queues:
                    del self._subscribers[user_id]
            logger.info(
                f"User '{user_id}' unsubscribed. Remaining active users: {len(self._subscribers)}"
            )

    async def publish(self, event: SystemEvent) -> None:
        """
        Publishes event to all active subscriber queues asynchronously.
        """
        self.publish_nowait(event)

    def publish_nowait(self, event: SystemEvent) -> None:
        """
        Synchronous-safe publishing method.
        Can be invoked directly from sync DB hooks, service functions post-commit,
        or async handlers without blocking.
        """
        self._event_counter += 1
        if event.id is None:
            event.id = self._event_counter

        for user_id, queues in list(self._subscribers.items()):
            for queue in list(queues):
                try:
                    queue.put_nowait(event)
                except asyncio.QueueFull:
                    # Discard oldest event from queue to avoid blocking publisher
                    try:
                        queue.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                    try:
                        queue.put_nowait(event)
                    except asyncio.QueueFull:
                        pass

    def get_subscriber_count(self) -> int:
        """Total active subscriber queues across all users."""
        return sum(len(q_list) for q_list in self._subscribers.values())

    def get_user_connection_count(self, user_id: str) -> int:
        """Number of active connections for a specific user."""
        return len(self._subscribers.get(user_id, []))


# Global singleton event bus instance
event_bus = InMemoryEventBus()
