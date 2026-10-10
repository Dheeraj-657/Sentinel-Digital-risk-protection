"""Analysis job queue — execution strategy boundary.

Two interchangeable implementations selected by Settings.worker_mode:
- InProcessJobQueue: asyncio workers consume an in-memory queue in the API
  process (production default for single-node deployments).
- SyncJobQueue: executes inline within the request (deterministic tests,
  and deployments that prefer request-scoped execution).

Swapping in a broker-backed queue (Celery/Arq/SQS) means implementing the
same AnalysisJobQueue protocol — no business code changes.
"""
from __future__ import annotations

import asyncio
import uuid
from typing import Callable, Protocol

from sqlalchemy.orm import Session, sessionmaker

from app.core.logging import get_correlation_id, get_logger, set_correlation_id
from app.core.observability import metrics
from app.services.analysis import AnalysisExecutor

logger = get_logger("app.worker")


class AnalysisJobQueue(Protocol):
    async def enqueue(self, job_id: uuid.UUID, correlation_id: str | None = None) -> None: ...
    async def start(self) -> None: ...
    async def stop(self) -> None: ...
    async def join(self) -> None: ...


def executor_factory(
    *,
    brand_client,
    entity_provider,
    evidence_provider,
    models,
    risk_service,
    evidence_service,
    publisher,
) -> Callable[[Session], AnalysisExecutor]:
    """Bind the process-wide collaborators once; each job gets a fresh session."""

    def _build(session: Session) -> AnalysisExecutor:
        return AnalysisExecutor(
            session=session,
            brand_client=brand_client,
            entity_provider=entity_provider,
            evidence_provider=evidence_provider,
            models=models,
            risk_service=risk_service,
            evidence_service=evidence_service,
            publisher=publisher,
        )

    return _build


def execute_inline(
    factory: Callable[[Session], AnalysisExecutor],
    session_factory: sessionmaker,
    job_id: uuid.UUID,
    correlation_id: str | None = None,
) -> None:
    """Run one job synchronously on the calling thread. Used by SyncJobQueue
    and by the discovery pipeline to chain analysis jobs without deadlocking
    on the event loop it may already be running on."""
    if correlation_id:
        set_correlation_id(correlation_id)
    with session_factory() as session:
        executor = factory(session)
        # Executor only flushes; the caller owns the transaction boundary.
        # (On failure the executor commits FAILED state itself.)
        executor.execute(job_id)
        session.commit()


class SyncJobQueue:
    """Executes jobs immediately on enqueue (worker_mode=sync)."""

    def __init__(self, factory: Callable[[Session], AnalysisExecutor],
                 session_factory: sessionmaker) -> None:
        self._factory = factory
        self._session_factory = session_factory

    async def enqueue(self, job_id: uuid.UUID, correlation_id: str | None = None) -> None:
        execute_inline(self._factory, self._session_factory, job_id, correlation_id)

    async def start(self) -> None: ...
    async def stop(self) -> None: ...
    async def join(self) -> None: ...


class InProcessJobQueue:
    """MOCK-ish transport: asyncio workers in the API process. Durability is
    NOT provided — a broker-backed queue is the EXTERNAL_DEPENDENCY upgrade."""

    def __init__(self, factory: Callable[[Session], AnalysisExecutor],
                 session_factory: sessionmaker, concurrency: int = 2) -> None:
        self._factory = factory
        self._session_factory = session_factory
        self._concurrency = max(1, concurrency)
        self._queue: asyncio.Queue[uuid.UUID] = asyncio.Queue()
        self._correlations: dict[uuid.UUID, str] = {}
        self._workers: list[asyncio.Task] = []

    async def enqueue(self, job_id: uuid.UUID, correlation_id: str | None = None) -> None:
        if correlation_id:
            self._correlations[job_id] = correlation_id
        metrics.inc_counter("jobs_enqueued_total")
        await self._queue.put(job_id)

    async def start(self) -> None:
        for i in range(self._concurrency):
            self._workers.append(asyncio.create_task(self._worker(i)))

    async def stop(self) -> None:
        for worker in self._workers:
            worker.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        self._workers.clear()

    async def join(self) -> None:
        await self._queue.join()

    async def _worker(self, index: int) -> None:
        while True:
            job_id = await self._queue.get()
            try:
                correlation_id = self._correlations.pop(job_id, None)
                if correlation_id:
                    set_correlation_id(correlation_id)
                with self._session_factory() as session:
                    executor = self._factory(session)
                    # Executor is sync DB work; keep the loop responsive.
                    await asyncio.to_thread(executor.execute, job_id)
                    session.commit()
            except Exception:
                # Executor persists FAILED state and re-raises; the queue must
                # survive so one bad job never kills the worker pool.
                logger.exception(
                    "job execution failed in worker",
                    extra={"context": {"job_id": str(job_id), "worker": index}},
                )
            finally:
                self._queue.task_done()
