"""In-process pub/sub used to push real-time updates to the browser over SSE."""

from __future__ import annotations

import asyncio
import datetime as dt
import json
from collections import deque
from typing import Any

MAX_QUEUE = 200


class EventBroker:
    """Fan-out broker with a small replay buffer for late subscribers."""

    def __init__(self, history_size: int = 40) -> None:
        self._subscribers: set[asyncio.Queue] = set()
        self._history: deque[dict] = deque(maxlen=history_size)
        self._loop: asyncio.AbstractEventLoop | None = None
        self._seq = 0

    def bind_loop(self, loop: asyncio.AbstractEventLoop | None = None) -> None:
        self._loop = loop or asyncio.get_event_loop()

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=MAX_QUEUE)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._subscribers.discard(queue)

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    def history(self) -> list[dict]:
        return list(self._history)

    def publish(self, event_type: str, payload: dict[str, Any] | None = None) -> dict:
        """Publish an event (safe to call from a worker thread)."""
        self._seq += 1
        event = {
            "seq": self._seq,
            "type": event_type,
            "at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "payload": payload or {},
        }
        self._history.append(event)

        for queue in list(self._subscribers):
            try:
                if self._loop is not None and self._loop.is_running():
                    self._loop.call_soon_threadsafe(self._offer, queue, event)
                else:
                    self._offer(queue, event)
            except RuntimeError:
                self._subscribers.discard(queue)
        return event

    @staticmethod
    def _offer(queue: asyncio.Queue, event: dict) -> None:
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:  # pragma: no cover - slow consumer
            pass

    @staticmethod
    def format_sse(event: dict) -> str:
        return f"event: {event['type']}\ndata: {json.dumps(event)}\n\n"


broker = EventBroker()
