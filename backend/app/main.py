"""FastAPI application factory for TRUSTGRAPH Module 2.

Startup wires real HTTP adapters when Module 1/3 base URLs are configured;
otherwise MOCK adapters are bound and the deployment is explicitly a
contract/dev environment (never presented as production intel).
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

import uuid as uuid_mod

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.api.v1 import analysis as analysis_router
from app.api.v1 import threats as threats_router
from app.core.config import Settings
from app.core.errors import AppError, ErrorCode
from app.core.logging import configure_logging, get_correlation_id, get_logger, new_correlation_id, set_correlation_id, set_request_id
from app.core.observability import metrics
from app.events.publisher import LoggingEventPublisher
from app.integrations.module1.mock import MockBrandDNAClient
from app.integrations.module1.sentinel import SentinelBrandClient
from app.integrations.module3.mock import MockEntityProvider, MockEvidenceProvider
from app.integrations.module3.providers import HTTPModule3Client
from app.ml.registry import build_model_set
from app.risk.config import DEFAULT_RISK_ENGINE_CONFIG
from app.schemas.common import HealthResponse
from app.services.evidence import EvidenceService
from app.services.queue import (
    InProcessJobQueue,
    SyncJobQueue,
    executor_factory,
)
from app.services.risk_service import RiskService

SERVICE_VERSION = "1.0.0"

logger = get_logger("app.main")


async def _correlation_middleware(request: Request, call_next):
    correlation_id = (
        request.headers.get("X-Correlation-ID") or new_correlation_id()
    )
    set_correlation_id(correlation_id)
    set_request_id(str(uuid_mod.uuid4()))
    response: Response = await call_next(request)
    response.headers["X-Correlation-ID"] = correlation_id
    return response


async def _metrics_middleware(request: Request, call_next):
    timer = metrics.start_timer()
    try:
        response = await call_next(request)
    except Exception:
        _observe_request(request, 500, timer)
        raise
    _observe_request(request, response.status_code, timer)
    return response


def _observe_request(request: Request, status_code: int, timer) -> None:
    route = request.scope.get("route")
    path = getattr(route, "path", request.url.path)
    # Avoid unbounded label cardinality from arbitrary 404 paths.
    if route is None and len(path) > 64:
        path = "/:unmatched"
    duration = timer()
    metrics.observe("http_request_duration_seconds", duration, method=request.method, path=path)
    metrics.inc_counter("http_requests_total", method=request.method, path=path, status=str(status_code))


async def _body_size_middleware(request: Request, call_next, max_bytes: int):
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > max_bytes:
        return JSONResponse(
            status_code=413,
            content={
                "error_code": ErrorCode.VALIDATION_ERROR.value,
                "message": "Request body too large.",
                "details": {"max_bytes": max_bytes},
                "correlation_id": get_correlation_id(),
            },
        )
    return await call_next(request)


def _register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(request: Request, exc: AppError):
        logger.error(
            "request_failed",
            exc_info=exc,
            extra={"context": {"error_code": exc.code.value, "path": request.url.path}},
        )
        return JSONResponse(
            status_code=exc.http_status,
            content={
                "error_code": exc.code.value,
                "message": exc.message,
                "details": exc.details or None,
                "correlation_id": get_correlation_id(),
            },
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError):
        logger.warning(
            "request_validation_failed",
            extra={"context": {"path": request.url.path, "errors": str(exc.errors())[:512]}},
        )
        return JSONResponse(
            status_code=422,
            content={
                "error_code": ErrorCode.VALIDATION_ERROR.value,
                "message": "Request validation failed.",
                "details": {
                    "errors": [
                        {"loc": [str(loc) for loc in err.get("loc", [])],
                         "message": err.get("msg", ""),
                         "type": err.get("type", "")}
                        for err in exc.errors()
                    ]
                },
                "correlation_id": get_correlation_id(),
            },
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception):
        # Stack traces stay in logs, never in responses.
        logger.exception(
            "unhandled_exception",
            extra={"context": {"path": request.url.path}},
        )
        return JSONResponse(
            status_code=500,
            content={
                "error_code": ErrorCode.INTERNAL_ERROR.value,
                "message": "Internal server error.",
                "details": None,
                "correlation_id": get_correlation_id(),
            },
        )


def create_app(settings: Settings | None = None, *, engine=None) -> FastAPI:
    """Build the app. `engine` is a test hook: inject a pre-created engine
    (e.g. in-memory SQLite with a StaticPool) instead of one built from
    settings.database_url."""
    settings = settings or Settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.settings = settings
        app.state.loop = asyncio.get_running_loop()
        app.state.logger = get_logger("app.api")

        db_engine = engine if engine is not None else create_engine(settings.database_url)
        app.state.engine = db_engine
        app.state.session_factory = sessionmaker(bind=db_engine, expire_on_commit=False)

        app.state.models = build_model_set(settings)
        app.state.risk_service = RiskService(DEFAULT_RISK_ENGINE_CONFIG)
        app.state.publisher = LoggingEventPublisher()

        if settings.module1_base_url:
            app.state.brand_client = SentinelBrandClient(
                settings.module1_base_url, settings.integration_http_timeout_seconds
            )
        else:
            app.state.brand_client = MockBrandDNAClient()

        if settings.module3_base_url:
            http_module3 = HTTPModule3Client(
                settings.module3_base_url, settings.integration_http_timeout_seconds
            )
            app.state.entity_provider = http_module3
            app.state.evidence_provider = http_module3
        else:
            app.state.entity_provider = MockEntityProvider()
            app.state.evidence_provider = MockEvidenceProvider()

        evidence_service = EvidenceService(
            app.state.evidence_provider, DEFAULT_RISK_ENGINE_CONFIG
        )
        app.state.evidence_service = evidence_service

        factory = executor_factory(
            brand_client=app.state.brand_client,
            entity_provider=app.state.entity_provider,
            evidence_provider=app.state.evidence_provider,
            models=app.state.models,
            risk_service=app.state.risk_service,
            evidence_service=app.state.evidence_service,
            publisher=app.state.publisher,
        )
        if settings.worker_mode.value == "sync":
            app.state.queue = SyncJobQueue(factory, app.state.session_factory)
        else:
            app.state.queue = InProcessJobQueue(
                factory, app.state.session_factory, settings.worker_concurrency
            )
        await app.state.queue.start()
        logger.info(
            "application_started",
            extra={"context": {
                "worker_mode": settings.worker_mode.value,
                "mock_integrations": settings.using_mock_integrations,
                "models": app.state.models.version_string,
            }},
        )
        try:
            yield
        finally:
            await app.state.queue.stop()
            db_engine.dispose()
            logger.info("application_stopped")

    app = FastAPI(
        title="TRUSTGRAPH Module 2 — AI Threat Detection & Risk Engine",
        version=SERVICE_VERSION,
        description=(
            "Explainable AI risk analysis of digital entities against Brand DNA. "
            "Every score is decomposed into weighted factors citing Module 3 evidence."
        ),
        lifespan=lifespan,
    )

    max_bytes = settings.max_request_body_bytes

    @app.middleware("http")
    async def correlation(request: Request, call_next):
        return await _correlation_middleware(request, call_next)

    @app.middleware("http")
    async def request_metrics(request: Request, call_next):
        return await _metrics_middleware(request, call_next)

    @app.middleware("http")
    async def body_size(request: Request, call_next):
        return await _body_size_middleware(request, call_next, max_bytes)

    _register_exception_handlers(app)

    app.include_router(analysis_router.router, prefix=settings.api_v1_prefix)
    app.include_router(threats_router.router, prefix=settings.api_v1_prefix)

    @app.get("/healthz", response_model=HealthResponse)
    def healthz() -> HealthResponse:
        return HealthResponse(version=SERVICE_VERSION)

    @app.get("/readyz")
    def readyz(request: Request) -> dict:
        checks: dict[str, str] = {}
        try:
            with request.app.state.session_factory() as session:
                session.execute(text("SELECT 1"))
            checks["database"] = "ok"
        except Exception:
            logger.warning("readiness_check_failed", extra={"context": {"check": "database"}})
            checks["database"] = "unavailable"
            return JSONResponse(status_code=503, content={"status": "unready", "checks": checks})
        return {"status": "ready", "checks": checks}

    @app.get("/metrics", response_class=PlainTextResponse)
    def prometheus_metrics() -> PlainTextResponse:
        return PlainTextResponse(metrics.render(), media_type="text/plain; version=0.0.4")

    return app


app = create_app()
