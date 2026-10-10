"""Structured errors — same envelope shape Module 2 renders
({"error_code", "message", "details"}). Stack traces never reach responses."""
from __future__ import annotations

import logging
from enum import Enum
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = logging.getLogger("module3.errors")


class ErrorCode(str, Enum):
    TENANT_REQUIRED = "TENANT_REQUIRED"
    NOT_FOUND = "NOT_FOUND"
    SOURCE_NOT_FOUND = "SOURCE_NOT_FOUND"
    DUPLICATE_ENTITY = "DUPLICATE_ENTITY"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    INTERNAL_ERROR = "INTERNAL_ERROR"


class AppError(Exception):
    """Structured application error rendered as the API error envelope."""

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        *,
        http_status: int = 400,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status
        self.details = details or {}


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(request: Request, exc: AppError):
        logger.error(
            "request_failed",
            extra={"context": {"error_code": exc.code.value, "path": request.url.path}},
        )
        return JSONResponse(
            status_code=exc.http_status,
            content={
                "error_code": exc.code.value,
                "message": exc.message,
                "details": exc.details or None,
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
                        {
                            "loc": [str(loc) for loc in err.get("loc", [])],
                            "message": err.get("msg", ""),
                            "type": err.get("type", ""),
                        }
                        for err in exc.errors()
                    ]
                },
            },
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception):
        # Stack traces stay in logs, never in responses.
        logger.exception(
            "unhandled_exception", extra={"context": {"path": request.url.path}}
        )
        return JSONResponse(
            status_code=500,
            content={
                "error_code": ErrorCode.INTERNAL_ERROR.value,
                "message": "Internal server error.",
                "details": None,
            },
        )
