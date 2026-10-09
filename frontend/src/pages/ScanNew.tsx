import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApi, errorMessage } from "../lib/hooks";
import { m1 } from "../lib/api";
import { M1_ENTITY_TYPE_LABEL } from "../lib/format";
import {
  Button,
  Card,
  CardHeader,
  ErrorState,
  PageHeader,
} from "../components/ui";
import type { M1EntityType } from "../lib/types";

const inputClass =
  "w-full rounded border border-line bg-ink px-2.5 py-1.5 text-sm text-fg placeholder:text-faint focus:border-action/60 focus:outline-none";

const ENTITY_TYPES: M1EntityType[] = ["PROFILE", "WEBSITE", "DOMAIN", "APP"];

const PLACEHOLDERS: Record<M1EntityType, string> = {
  PROFILE: "@acme_support_official",
  WEBSITE: "https://support-acme.example/login",
  DOMAIN: "acme-support.example",
  APP: "com.acme.support",
};

export function ScanNew() {
  const navigate = useNavigate();
  const brands = useApi(() => m1.listBrands(), []);

  const [entityType, setEntityType] = useState<M1EntityType>("WEBSITE");
  const [input, setInput] = useState("");
  const [claimedDeveloper, setClaimedDeveloper] = useState("");
  const [brandId, setBrandId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (trimmed.length < 3) {
      setError("Enter the profile handle, URL, domain, or package to analyse (at least 3 characters).");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const report = await m1.createScan({
        entityType,
        input: trimmed,
        ...(claimedDeveloper.trim() ? { claimedDeveloper: claimedDeveloper.trim() } : {}),
        ...(brandId ? { brandId } : {}),
      });
      navigate(`/scans/${report.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="New engine scan"
        description="Run the Sentinel risk engine directly on a profile, website, domain, or app. The engine normalizes the input, collects intelligence, and scores it — optionally against one of your protected brands."
      />

      {brands.error ? (
        <Card className="mb-4">
          <ErrorState error={brands.error} onRetry={brands.reload} context="brands" />
        </Card>
      ) : null}

      <form onSubmit={submit}>
        <Card>
          <CardHeader
            title="Scan target"
            description="What should the risk engine analyse?"
          />
          <div className="grid gap-5 px-4 py-4 sm:px-5 md:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="scan-type" className="block text-[11px] font-medium uppercase tracking-widest text-faint">
                Entity type <span className="text-risk-medium">*</span>
              </label>
              <select
                id="scan-type"
                value={entityType}
                onChange={(event) => setEntityType(event.target.value as M1EntityType)}
                className={inputClass}
              >
                {ENTITY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {M1_ENTITY_TYPE_LABEL[type]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="scan-input" className="block text-[11px] font-medium uppercase tracking-widest text-faint">
                Input <span className="text-risk-medium">*</span>
              </label>
              <input
                id="scan-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={PLACEHOLDERS[entityType]}
                spellCheck={false}
                className={inputClass}
                aria-required="true"
                aria-describedby="scan-input-hint"
              />
              <p id="scan-input-hint" className="text-[11px] leading-relaxed text-faint">
                The engine normalizes this into a stable target — handles, URLs, domains,
                and package names are all supported.
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="scan-brand" className="block text-[11px] font-medium uppercase tracking-widest text-faint">
                Protected brand
              </label>
              {brands.loading ? (
                <p className="text-xs text-faint">Loading brands…</p>
              ) : (
                <select
                  id="scan-brand"
                  value={brandId}
                  onChange={(event) => setBrandId(event.target.value)}
                  className={inputClass}
                >
                  <option value="">No brand context (generic risk scan)</option>
                  {(brands.data?.items ?? []).map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                      {brand.isDemo ? " (demo)" : ""}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-[11px] leading-relaxed text-faint">
                Selecting a brand scores impersonation and similarity against its
                official domains, handles, and keywords.{" "}
                <Link to="/brands" className="text-action hover:underline">
                  Manage brands
                </Link>
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="scan-developer" className="block text-[11px] font-medium uppercase tracking-widest text-faint">
                Claimed developer
              </label>
              <input
                id="scan-developer"
                value={claimedDeveloper}
                onChange={(event) => setClaimedDeveloper(event.target.value)}
                placeholder="e.g. Acme Corp (as the entity claims)"
                className={inputClass}
                maxLength={120}
              />
              <p className="text-[11px] leading-relaxed text-faint">
                Optional context — what the entity claims about who runs it. The engine
                checks the claim against the selected brand.
              </p>
            </div>
          </div>

          {error ? (
            <p role="alert" className="border-t border-line-soft px-4 py-3 text-xs text-risk-medium sm:px-5">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3 border-t border-line-soft px-4 py-4 sm:px-5">
            <Button variant="primary" type="submit" disabled={submitting}>
              {submitting ? "Scanning…" : "Run scan"}
            </Button>
            <span className="text-[11px] text-faint">
              Scans run synchronously — you'll land on the full report.
            </span>
          </div>
        </Card>
      </form>
    </>
  );
}
