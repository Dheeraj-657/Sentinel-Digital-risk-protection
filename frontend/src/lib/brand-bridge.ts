import { v5 as uuidv5 } from "uuid";
import type { M1Brand } from "./types";

// RFC 4122 DNS namespace — uuid v11 no longer exports NAMESPACE_DNS as a
// named constant; v5() accepts the canonical UUID string directly.
const NAMESPACE_DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

// Mirrors backend/app/integrations/module1/sentinel.py:
//   SENTINEL_BRAND_NAMESPACE = uuid5(NAMESPACE_DNS, "trustgraph.module1.sentinel")
//   brand_uuid = uuid5(SENTINEL_BRAND_NAMESPACE, sentinel_cuid)
// Module 2 references brands by the derived UUID; the console derives the
// same UUID client-side so threat rows can be mapped back to brand names.
export const SENTINEL_BRAND_NAMESPACE = uuidv5(
  "trustgraph.module1.sentinel",
  NAMESPACE_DNS,
);

export function brandUuidFromCuid(cuid: string): string {
  return uuidv5(cuid, SENTINEL_BRAND_NAMESPACE);
}

export function findBrandForUuid(brands: M1Brand[], brandUuid: string): M1Brand | undefined {
  const target = brandUuid.toLowerCase();
  return brands.find((brand) => brandUuidFromCuid(brand.id) === target);
}
