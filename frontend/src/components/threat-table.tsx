import { Link } from "react-router-dom";
import { cx, formatDateTime, RISK_LEVEL_CLASS } from "../lib/format";
import { useEnrichment } from "../lib/hooks";
import type { ThreatSummary } from "../lib/types";
import { Badge } from "./ui";

const STATUS_TONE: Record<string, "low" | "medium" | "neutral"> = {
  OPEN: "medium",
  CONFIRMED: "low",
  DISMISSED: "neutral",
};

/** Table of threats with resolved entity/brand names. All data real — rows
 * link to the threat detail page. */
export function ThreatTable({
  threats,
  showBrand = true,
}: {
  threats: ThreatSummary[];
  showBrand?: boolean;
}) {
  const { entityName, brandName } = useEnrichment();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line-soft text-[11px] uppercase tracking-widest text-faint">
            <th scope="col" className="px-4 py-2.5 font-medium sm:px-5">
              Risk
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Classification
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Entity
            </th>
            {showBrand ? (
              <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">
                Brand
              </th>
            ) : null}
            <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">
              Status
            </th>
            <th scope="col" className="hidden px-4 py-2.5 font-medium lg:table-cell">
              Analyzed
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft">
          {threats.map((threat) => (
            <tr key={threat.threat_id} className="group transition hover:bg-raised/50">
              <td className="px-4 py-3 sm:px-5">
                <Link
                  to={`/threats/${threat.threat_id}`}
                  className="flex items-center gap-2.5 focus-visible:outline-none"
                >
                  <span
                    className={cx(
                      "font-condensed font-mono text-xl font-bold leading-none",
                      RISK_LEVEL_CLASS[threat.risk_level],
                    )}
                  >
                    {Math.round(threat.risk_score)}
                  </span>
                  <span className="text-[11px] font-medium text-muted">
                    {threat.risk_level}
                  </span>
                </Link>
              </td>
              <td className="px-4 py-3">
                <Link to={`/threats/${threat.threat_id}`} className="text-fg hover:text-action">
                  {threat.classification.replace(/_/g, " ").toLowerCase()}
                </Link>
              </td>
              <td className="max-w-56 truncate px-4 py-3">
                <Link
                  to={`/entities/${threat.entity_id}`}
                  className="text-muted hover:text-action"
                  title={entityName(threat.entity_id)}
                >
                  {entityName(threat.entity_id)}
                </Link>
              </td>
              {showBrand ? (
                <td className="hidden px-4 py-3 text-muted md:table-cell">
                  {brandName(threat.brand_id)}
                </td>
              ) : null}
              <td className="hidden px-4 py-3 sm:table-cell">
                <Badge tone={STATUS_TONE[threat.status] ?? "neutral"}>{threat.status}</Badge>
              </td>
              <td className="hidden whitespace-nowrap px-4 py-3 text-xs text-muted lg:table-cell">
                {formatDateTime(threat.analysis_timestamp)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
