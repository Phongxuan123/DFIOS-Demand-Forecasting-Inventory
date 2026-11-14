from abc import ABC, abstractmethod
import asyncio
import logging
from typing import Dict, List, Optional

from app.schemas.event import SystemEvent, mask_email

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
    async def subscribe(self, user_id: str, role: Optional[str] = None) -> asyncio.Queue:
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
        self._user_roles: Dict[str, str] = {}
        self._event_counter: int = 0
        self._lock: Optional[asyncio.Lock] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def _get_lock(self) -> asyncio.Lock:
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    async def subscribe(self, user_id: str, role: Optional[str] = None) -> asyncio.Queue:
        if self._loop is None or self._loop.is_closed():
            self._loop = asyncio.get_running_loop()
        lock = self._get_lock()
        async with lock:
            if role:
                self._user_roles[user_id] = role
            if user_id not in self._subscribers:
                self._subscribers[user_id] = []

            user_queues = self._subscribers[user_id]

            # Enforce connection limit: close oldest connection if threshold reached (B-11)
            if len(user_queues) >= self.max_connections_per_user:
                oldest_queue = user_queues.pop(0)
                try:
                    # Clear room if queue is full so sentinel None is guaranteed to be received
                    if oldest_queue.full():
                        try:
                            oldest_queue.get_nowait()
                        except (asyncio.QueueEmpty, Exception):
                            pass
                    oldest_queue.put_nowait(None)
                except Exception as e:
                    logger.warning(f"Failed to signal close to oldest SSE connection: {e}")

            new_queue: asyncio.Queue = asyncio.Queue(maxsize=self.queue_maxsize)
            user_queues.append(new_queue)
            logger.info(
                f"User '{user_id}' (role: {role}) subscribed. Active connections for user: {len(user_queues)}"
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
                    if user_id in self._user_roles:
                        del self._user_roles[user_id]
            logger.info(
                f"User '{user_id}' unsubscribed. Remaining active users: {len(self._subscribers)}"
            )

    async def publish(self, event: SystemEvent) -> None:
        """
        Publishes event to all active subscriber queues asynchronously.
        """
        self.publish_nowait(event)

    @staticmethod
    def _push_to_queue(queue: asyncio.Queue, event: Optional[SystemEvent]) -> None:
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            # Discard oldest event from queue to avoid blocking publisher
            try:
                queue.get_nowait()
            except (asyncio.QueueEmpty, Exception):
                pass
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                pass

    def publish_nowait(self, event: SystemEvent) -> None:
        """
        Synchronous-safe and thread-safe publishing method.
        When invoked from worker threads (e.g. FastAPI threadpool), dispatches safely
        to the event loop via loop.call_soon_threadsafe.
        """
        self._event_counter += 1
        if event.id is None:
            event.id = self._event_counter

        loop = self._loop
        if loop is None or loop.is_closed():
            try:
                loop = asyncio.get_running_loop()
                self._loop = loop
            except RuntimeError:
                loop = None

        is_same_thread = False
        if loop and not loop.is_closed():
            try:
                is_same_thread = (asyncio.get_running_loop() is loop)
            except RuntimeError:
                is_same_thread = False

        for user_id, queues in list(self._subscribers.items()):
            user_role = self._user_roles.get(user_id)
            # 1. Role filtering: If target_roles is specified, skip unauthorized subscribers
            if event.target_roles is not None:
                if not user_role or user_role not in event.target_roles:
                    continue

            # 2. Payload sanitization: Mask email in actor_id for non-privileged subscribers
            event_to_dispatch = event
            if user_role not in ("Admin", "Warehouse Manager"):
                if isinstance(event.data, dict) and "actor_id" in event.data:
                    raw_actor = event.data["actor_id"]
                    if isinstance(raw_actor, str) and "@" in raw_actor:
                        sanitized_data = dict(event.data)
                        sanitized_data["actor_id"] = mask_email(raw_actor)
                        event_to_dispatch = SystemEvent(
                            id=event.id,
                            event=event.event,
                            data=sanitized_data,
                            target_roles=event.target_roles,
                        )

            for queue in list(queues):
                if loop and not loop.is_closed() and not is_same_thread:
                    loop.call_soon_threadsafe(self._push_to_queue, queue, event_to_dispatch)
                else:
                    self._push_to_queue(queue, event_to_dispatch)

    def get_subscriber_count(self) -> int:
        """Total active subscriber queues across all users."""
        return sum(len(q_list) for q_list in self._subscribers.values())

    def get_user_connection_count(self, user_id: str) -> int:
        """Number of active connections for a specific user."""
        return len(self._subscribers.get(user_id, []))


# Global singleton event bus instance
event_bus = InMemoryEventBus()
