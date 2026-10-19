"""Server-Sent Events stream so the dashboard and map update in real time."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from ..events import broker

router = APIRouter(prefix="/api/stream", tags=["realtime"])

HEARTBEAT_S = 15.0

SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


@router.get("/events")
async def stream_events(request: Request):
    queue = broker.subscribe()

    async def event_source():
        try:
            yield ": connected\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_S)
                except asyncio.TimeoutError:
                    yield f": keep-alive {asyncio.get_event_loop().time():.0f}\n\n"
                    continue
                yield broker.format_sse(event)
        finally:
            broker.unsubscribe(queue)

    return StreamingResponse(event_source(), media_type="text/event-stream", headers=SSE_HEADERS)


@router.get("/status")
async def stream_status():
    return {
        "subscribers": broker.subscriber_count,
        "last_seq": broker.history()[-1]["seq"] if broker.history() else 0,
        "recent": broker.history()[-5:],
    }
