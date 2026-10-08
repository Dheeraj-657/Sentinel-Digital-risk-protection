"""Module 1 Brand DNA contract.

STATUS: CONTRACT_PROPOSED — Module 1 (Brand Intelligence) does not exist in
this repository. Module 2 defines the minimal shape of Brand DNA it needs and
consumes it exclusively through app/integrations/module1 BrandDNAClient.
When Module 1 ships, ITS actual contract wins and this schema is adapted —
Module 2 must never duplicate Module 1 internal models.
"""
from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, Field


class BrandIdentity(BaseModel):
    """Canonical identity signals used for identity/text similarity."""

    model_config = ConfigDict(frozen=True)

    name: str = Field(min_length=1)
    legal_name: str | None = None
    aliases: list[str] = Field(default_factory=list)
    tagline: str | None = None


class BrandDomain(BaseModel):
    model_config = ConfigDict(frozen=True)

    domain: str = Field(min_length=1, description="Registrable domain, e.g. acme.com")
    is_primary: bool = False


class BrandSocialProfile(BaseModel):
    model_config = ConfigDict(frozen=True)

    platform: str
    handle: str
    url: str | None = None


class BrandVisualAsset(BaseModel):
    """Visual anchors. content_hash is a perceptual hash (hex) comparable via
    the configured VisualSimilarityModel — Module 2 never fetches raw assets."""

    model_config = ConfigDict(frozen=True)

    asset_id: str
    kind: str = Field(description="e.g. logo, banner")
    content_hash: str | None = Field(
        default=None, description="Perceptual hash of the asset, hex string"
    )


class BrandTextSignal(BaseModel):
    model_config = ConfigDict(frozen=True)

    signal_id: str
    text: str


class BrandVerification(BaseModel):
    """Verification configuration Module 2 honors when scoring impersonation."""

    model_config = ConfigDict(frozen=True)

    verified_domains: list[str] = Field(default_factory=list)
    verified_social_handles: list[str] = Field(default_factory=list)


class BrandDNA(BaseModel):
    """Aggregate contract. Version enables cache invalidation and reproducibility."""

    model_config = ConfigDict(frozen=True)

    brand_id: uuid.UUID
    version: str = Field(min_length=1)
    identity: BrandIdentity
    domains: list[BrandDomain] = Field(default_factory=list)
    social_profiles: list[BrandSocialProfile] = Field(default_factory=list)
    visual_assets: list[BrandVisualAsset] = Field(default_factory=list)
    text_signals: list[BrandTextSignal] = Field(default_factory=list)
    verification: BrandVerification = Field(default_factory=BrandVerification)
