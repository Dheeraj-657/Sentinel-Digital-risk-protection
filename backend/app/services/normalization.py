"""Normalization utilities — pure functions, unit-testable in isolation.

Normalization runs BEFORE any model inference so similarity is always
computed over canonical forms.
"""
from __future__ import annotations

import re

_HANDLE_STRIP = re.compile(r"^@+")
_URL_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*://")
_WWW_PREFIX = re.compile(r"^www\.", re.IGNORECASE)
_PORT = re.compile(r":\d+$")
_PATH = re.compile(r"[/?#].*$")


def normalize_text(value: str | None) -> str:
    """Collapse whitespace, strip, lowercase. Empty string for None."""
    if not value:
        return ""
    return " ".join(value.split()).strip().lower()


def normalize_handle(value: str | None) -> str:
    """'@Acme_Help ' → 'acme_help'."""
    if not value:
        return ""
    return _HANDLE_STRIP.sub("", value.strip()).lower()


def registrable_domain(value: str | None) -> str:
    """Extract a registrable domain from a URL or domain string.

    Naive last-two-labels heuristic — deliberately dependency-free until
    Module 3 supplies normalized domains. 'https://support.acme.com/x' →
    'acme.com'.
    """
    if not value:
        return ""
    cleaned = value.strip().lower()
    cleaned = _URL_SCHEME.sub("", cleaned)
    cleaned = _PATH.sub("", cleaned)
    cleaned = _PORT.sub("", cleaned)
    cleaned = _WWW_PREFIX.sub("", cleaned)
    if "/" in cleaned:
        cleaned = cleaned.split("/", 1)[0]
    labels = [label for label in cleaned.split(".") if label]
    if len(labels) >= 2:
        return ".".join(labels[-2:])
    return ".".join(labels)


def normalize_domain(value: str | None) -> str:
    return registrable_domain(value)
