"""Normalization at ingest — canonical forms stored once, reused downstream.

Module 2 re-normalizes defensively on its own side (it cannot trust
upstream), so these functions deliberately produce the SAME canonical
results Module 2 derives (backend/app/services/normalization.py) for
domains and handles — but stop at cleaning: no registrable-domain
interpretation, which belongs to Module 2's comparison layer.
"""
from __future__ import annotations

import re

_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*://", re.IGNORECASE)
_PORT = re.compile(r":\d+$")
_PATH = re.compile(r"[/?#].*$")
_WWW = re.compile(r"^www\.", re.IGNORECASE)
_HANDLE_AT = re.compile(r"^@+")


def normalize_domain(value: str | None) -> str:
    """'https://WWW.Acme-Support.com/verify?x=1' -> 'acme-support.com'.

    Lowercase, strip scheme / path / port / leading 'www.'. Cleaning only —
    'support.acme.com' stays 'support.acme.com' (no last-two-labels
    collapse; Module 2 applies that when comparing against Brand DNA).
    """
    if not value:
        return ""
    cleaned = value.strip().lower()
    cleaned = _SCHEME.sub("", cleaned)
    cleaned = _PATH.sub("", cleaned)
    cleaned = _PORT.sub("", cleaned)
    cleaned = _WWW.sub("", cleaned)
    return cleaned


def normalize_handle(value: str | None) -> str:
    """'@Acme_Help ' -> 'acme_help' (same result Module 2 derives)."""
    if not value:
        return ""
    return _HANDLE_AT.sub("", value.strip()).lower()


def normalize_identifiers(identifiers: dict[str, str]) -> dict[str, str]:
    """Canonicalize known identifier kinds ('domain', 'handle'); other keys
    pass through (whitespace-stripped). Empty values are dropped."""
    normalized: dict[str, str] = {}
    for key, value in identifiers.items():
        key = key.strip().lower()
        if key == "domain":
            cleaned = normalize_domain(value)
        elif key == "handle":
            cleaned = normalize_handle(value)
        else:
            cleaned = value.strip()
        if cleaned:
            normalized[key] = cleaned
    return normalized
