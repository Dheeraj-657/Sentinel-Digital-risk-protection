"""TRUSTGRAPH Module 4 — Dashboard & AI Security Analyst (backend integration).

Isolated, additive package. It READS Module 2's threat register and reuses
Module 2's existing collaborators (RelatedThreatService, the Module 1 brand
client and the Module 3 entity/evidence adapters) to assemble grounded
context for analyst questions. It never scores, re-scores, writes threats,
collects evidence or performs external security actions.

Wiring: backend/app/main.py includes `app.module4.router.router`.
"""
