import type { Metadata } from "next";
import Link from "next/link";
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { NavLinks } from "@/components/ui/nav-links";
import { getIntelMode } from "@/lib/engine/providers/registry";
import { isGroqConfigured, groqModel } from "@/lib/ai/groq";

export const metadata: Metadata = {
  title: "Sentinel — Digital Risk Protection",
  description: "AI Threat Intelligence & Risk Engine for brand impersonation, scam accounts, look-alike domains and malicious apps.",
};

function Mark() {
  // A shield cut by a scan line — the product's own mark.
  return (
    <svg viewBox="0 0 28 28" className="size-7" aria-hidden>
      <path d="M14 2.5 4 6.3v7.2c0 6.1 4.2 10.6 10 12 5.8-1.4 10-5.9 10-12V6.3L14 2.5Z" fill="none" stroke="var(--color-action)" strokeWidth="1.8" />
      <path d="M7.5 14.2h13" stroke="var(--color-risk-critical)" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="14" cy="14.2" r="2.2" fill="var(--color-risk-critical)" />
    </svg>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const mode = getIntelMode();
  const ai = isGroqConfigured();
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <div className="lg:grid lg:min-h-dvh lg:grid-cols-[232px_1fr]">
          <aside className="sticky top-0 z-20 flex items-center gap-4 border-b border-line bg-ink/95 px-4 py-3 backdrop-blur lg:h-dvh lg:flex-col lg:items-stretch lg:border-r lg:border-b-0 lg:px-4 lg:py-6">
            <Link href="/" className="flex items-center gap-2.5 lg:mb-8 lg:px-2">
              <Mark />
              <span className="leading-tight">
                <span className="block text-[17px] font-bold tracking-tight">Sentinel</span>
                <span className="hidden text-xs text-muted lg:block">Digital risk protection</span>
              </span>
            </Link>
            <div className="ml-auto overflow-x-auto lg:ml-0">
              <NavLinks />
            </div>
            <div className="mt-auto hidden space-y-2 rounded-md border border-line-soft p-3 text-xs text-muted lg:block">
              <p className="flex items-center justify-between">
                <span>Intel sources</span>
                <span className={mode === "live" ? "text-risk-verylow" : "text-risk-medium"}>{mode === "live" ? "Live + demo" : "Demo dataset"}</span>
              </p>
              <p className="flex items-center justify-between gap-2">
                <span>AI assessment</span>
                <span className={ai ? "text-ai" : "text-faint"} title={ai ? groqModel() : "Set GROQ_API_KEY in .env"}>
                  {ai ? "Groq" : "Template only"}
                </span>
              </p>
            </div>
          </aside>
          <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-9">{children}</main>
        </div>
      </body>
    </html>
  );
}
