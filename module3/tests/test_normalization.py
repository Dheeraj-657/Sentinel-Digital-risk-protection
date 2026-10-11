"""Unit tests for ingest-time normalization (SYNTHETIC TEST_ONLY values)."""
from __future__ import annotations

import pytest

from module3.normalization import normalize_domain, normalize_handle, normalize_identifiers


class TestNormalizeDomain:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("acme-support.com", "acme-support.com"),
            ("ACME-SUPPORT.COM", "acme-support.com"),
            ("  acme-support.com  ", "acme-support.com"),
            ("https://acme-support.com/verify?x=1", "acme-support.com"),
            ("http://www.acme-support.com/login", "acme-support.com"),
            ("https://WWW.Acme-Support.com/verify#frag", "acme-support.com"),
            ("https://acme-support.com:8080/login", "acme-support.com"),
            ("acme-support.com:8080", "acme-support.com"),
            ("www.acme.com", "acme.com"),
            ("support.acme.com", "support.acme.com"),
            ("", ""),
            (None, ""),
        ],
    )
    def test_domain(self, raw, expected):
        assert normalize_domain(raw) == expected


class TestNormalizeHandle:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("@acme_help", "acme_help"),
            ("@@acme_help", "acme_help"),
            ("  @Acme_Help  ", "acme_help"),
            ("Acme_Help", "acme_help"),
            ("", ""),
            (None, ""),
        ],
    )
    def test_handle(self, raw, expected):
        assert normalize_handle(raw) == expected


class TestNormalizeIdentifiers:
    def test_domain_and_handle_keys_normalized(self):
        result = normalize_identifiers(
            {
                "domain": "https://WWW.Acme-Support.com/verify",
                "handle": "@Acme_Help",
            }
        )
        assert result == {"domain": "acme-support.com", "handle": "acme_help"}

    def test_keys_are_lowercased(self):
        result = normalize_identifiers({"Domain": "ACME.com"})
        assert result == {"domain": "acme.com"}

    def test_unknown_keys_pass_through_stripped(self):
        result = normalize_identifiers({"app_id": " com.example.fake "})
        assert result == {"app_id": "com.example.fake"}

    def test_empty_values_are_dropped(self):
        result = normalize_identifiers({"domain": "   ", "handle": "@acme_help"})
        assert result == {"handle": "acme_help"}

    def test_empty_input(self):
        assert normalize_identifiers({}) == {}
