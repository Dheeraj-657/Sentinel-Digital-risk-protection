import type { z } from "zod";
import { brandInputSchema, normalizeBrand } from "./engine/entity";

export type BrandInput = z.infer<typeof brandInputSchema>;

/**
 * Single place raw brand input becomes canonical Prisma column data —
 * shared by POST /api/brands and PATCH /api/brands/[id] so create and
 * edit can never drift apart. Delegates to normalizeBrand, which owns
 * the canonical domain/handle/prefix/keyword forms; strips `id` so the
 * caller's where-clause is the only source of identity.
 */
export function normalizeBrandInput(b: BrandInput) {
  const brand = normalizeBrand(b);
  return {
    name: brand.name,
    officialDomains: brand.officialDomains,
    officialHandles: brand.officialHandles,
    appDevelopers: brand.appDevelopers,
    packagePrefixes: brand.packagePrefixes,
    keywords: brand.keywords,
  };
}
