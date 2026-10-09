"""FastAPI application factory for TRUSTGRAPH Module 3 (Digital Intelligence).

Serves the entity/evidence contract Module 2's HTTPModule3Client expects:
GET /api/v1/entities/{id} and GET /api/v1/entities/{id}/evidence with
X-Tenant-ID scoping. Ingestion endpoints accept data from operators or
clearly labelled fixtures; this module never scrapes or invents live
discovery results.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy.orm import sessionmaker

from module3.api import router
from module3.config import Settings, get_settings
from module3.database import build_engine
from module3.errors import register_exception_handlers

logger = logging.getLogger("module3")

SERVICE_VERSION = "1.0.0"


def _safe_url(url: str) -> str:
    """Mask credentials before logging a database URL."""
    if "://" in url and "@" in url:
        scheme, rest = url.split("://", 1)
        if "@" in rest:
            _, host = rest.rsplit("@", 1)
            return f"{scheme}://***@{host}"
    return url


def create_app(settings: Settings | None = None, *, engine=None) -> FastAPI:
    """Build the app. `engine` is a test hook: inject a pre-created engine
    (e.g. in-memory SQLite with a StaticPool) instead of one built from
    settings.database_url."""
    settings = settings or get_settings()
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO)
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.settings = settings
        db_engine = engine if engine is not None else build_engine(settings.database_url)
        app.state.engine = db_engine
        app.state.session_factory = sessionmaker(
            bind=db_engine, autoflush=False, expire_on_commit=False
        )
        logger.info(
            "module3_started",
            extra={"context": {"database_url": _safe_url(settings.database_url)}},
        )
        try:
            yield
        finally:
            if engine is None:
                db_engine.dispose()
            logger.info("module3_stopped")

    app = FastAPI(
        title="TRUSTGRAPH Module 3 — Digital Intelligence",
        version=SERVICE_VERSION,
        description=(
            "Entity and evidence layer with source provenance and ingest-time "
            "normalization. Feeds Module 2's risk engine through the "
            "CONTRACT_PROPOSED wire contract (X-Tenant-ID scoped)."
        ),
        lifespan=lifespan,
    )

    register_exception_handlers(app)
    app.include_router(router)

    @app.get("/healthz")
    def healthz() -> dict:
        return {"status": "ok", "service": "module3", "version": SERVICE_VERSION}

    return app


app = create_app()
