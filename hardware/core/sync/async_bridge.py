from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import TypeVar

T = TypeVar("T")


def run_coro_sync(coro: "asyncio.Future[T] | asyncio.coroutines.Coroutine[object, object, T]", *, timeout: int = 60) -> T:
    """Run a coroutine from sync code, even if an event loop is already running."""
    try:
        loop = asyncio.get_running_loop()
        loop_running = loop.is_running()
    except RuntimeError:
        loop_running = False

    if loop_running:
        with ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(lambda: asyncio.run(coro)).result(timeout=timeout)

    return asyncio.run(coro)
