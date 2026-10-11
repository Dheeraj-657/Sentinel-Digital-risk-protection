"""Cross-module integration adapters.

Boundary rule: Module 2 consumes Module 1 (Brand DNA) and Module 3
(entities/evidence) exclusively through the interfaces in this package.
HTTP implementations are thin; mock implementations exist for tests and
local development only, and are clearly labeled MOCK.
"""
