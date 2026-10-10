from __future__ import annotations

from enum import Enum
from typing import Any


class ErrorCode(str, Enum):
    INVALID_ENTITY = "INVALID_ENTITY"
    MISSING_BRAND_DNA = "MISSING_BRAND_DNA"
    ANALYSIS_FAILED = "ANALYSIS_FAILED"
    MODEL_UNAVAILABLE = "MODEL_UNAVAILABLE"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"
    ANALYSIS_TIMEOUT = "ANALYSIS_TIMEOUT"
    DUPLICATE_JOB = "DUPLICATE_JOB"
    DUPLICATE_ENTITY = "DUPLICATE_ENTITY"
    INTEGRATION_UNAVAILABLE = "INTEGRATION_UNAVAILABLE"
    NOT_FOUND = "NOT_FOUND"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    TENANT_REQUIRED = "TENANT_REQUIRED"
    INVALID_STATUS_TRANSITION = "INVALID_STATUS_TRANSITION"
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


class InvalidEntityError(AppError):
    def __init__(self, entity_id: str) -> None:
        super().__init__(
            ErrorCode.INVALID_ENTITY,
            f"Entity '{entity_id}' was not found or is not analyzable.",
            http_status=404,
            details={"entity_id": entity_id},
        )


class MissingBrandDNAError(AppError):
    def __init__(self, brand_id: str) -> None:
        super().__init__(
            ErrorCode.MISSING_BRAND_DNA,
            f"Brand DNA for brand '{brand_id}' is unavailable.",
            http_status=424,
            details={"brand_id": brand_id},
        )


class ModelUnavailableError(AppError):
    def __init__(self, model_name: str, reason: str) -> None:
        super().__init__(
            ErrorCode.MODEL_UNAVAILABLE,
            f"Model '{model_name}' is unavailable: {reason}",
            http_status=503,
            details={"model_name": model_name},
        )


class InsufficientEvidenceError(AppError):
    def __init__(self, evidence_count: int, minimum: int) -> None:
        super().__init__(
            ErrorCode.INSUFFICIENT_EVIDENCE,
            (
                f"Analysis cannot proceed: {evidence_count} evidence item(s) "
                f"available, minimum required is {minimum}."
            ),
            http_status=422,
            details={"evidence_count": evidence_count, "minimum_required": minimum},
        )


class AnalysisTimeoutError(AppError):
    def __init__(self, job_id: str, seconds: float) -> None:
        super().__init__(
            ErrorCode.ANALYSIS_TIMEOUT,
            f"Analysis job '{job_id}' exceeded the {seconds}s execution budget.",
            http_status=504,
            details={"job_id": job_id, "timeout_seconds": seconds},
        )


class DuplicateJobError(AppError):
    def __init__(self, idempotency_key: str) -> None:
        super().__init__(
            ErrorCode.DUPLICATE_JOB,
            (
                f"Idempotency-Key '{idempotency_key}' was already used with a "
                "different request payload."
            ),
            http_status=409,
            details={"idempotency_key": idempotency_key},
        )


class EntityAlreadyExistsError(AppError):
    """Module 3 already holds an entity with this natural key for the tenant."""

    def __init__(self, existing_entity_id: str) -> None:
        super().__init__(
            ErrorCode.DUPLICATE_ENTITY,
            f"Entity already exists: '{existing_entity_id}'.",
            http_status=409,
            details={"existing_entity_id": existing_entity_id},
        )
        self.existing_entity_id = existing_entity_id


class IntegrationUnavailableError(AppError):
    """Upstream module (Module 1/3) is unreachable or errored. Details are
    non-sensitive: no upstream response bodies are echoed back."""

    def __init__(self, integration: str, reason: str) -> None:
        super().__init__(
            ErrorCode.INTEGRATION_UNAVAILABLE,
            f"Integration '{integration}' is unavailable.",
            http_status=503,
            details={"integration": integration, "reason": reason},
        )
