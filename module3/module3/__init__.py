"""TRUSTGRAPH Module 3 — Digital Intelligence (Entity & Evidence).

Minimum viable implementation of the entity/evidence layer Module 2's
HTTPModule3Client already expects (CONTRACT_PROPOSED in
backend/app/schemas/entity.py). Owns: entity + evidence + source-provenance
persistence, ingest-time normalization, tenant-scoped retrieval APIs.
Never scrapes or invents live discovery results — fixtures are labelled.
"""
