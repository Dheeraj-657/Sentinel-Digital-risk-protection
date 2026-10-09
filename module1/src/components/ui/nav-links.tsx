"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ScanSearch, History, ShieldCheck } from "lucide-react";
import { cx } from "@/lib/ui";

const LINKS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/scan", label: "New analysis", icon: ScanSearch },
  { href: "/history", label: "Scan history", icon: History },
  { href: "/brands", label: "Protected brands", icon: ShieldCheck },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex gap-1 lg:flex-col">
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active =
          href === "/" ? path === "/" : href === "/scan" ? path === "/scan" : path.startsWith(href) || (href === "/history" && path.startsWith("/scans/"));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2 sm:px-3 text-sm whitespace-nowrap transition-colors",
              active ? "bg-raised font-semibold text-fg" : "text-muted hover:bg-raised/60 hover:text-fg",
            )}
          >
            <Icon className="size-4" aria-hidden />
            <span className="sr-only sm:not-sr-only">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
