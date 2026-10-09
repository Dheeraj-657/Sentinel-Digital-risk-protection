"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EntityType } from "@/lib/engine/types";

/** Guesses the entity type from a pasted value and hands off to the full scanner. */
function guessType(v: string): EntityType {
  const s = v.trim().toLowerCase();
  if (/^(instagram|ig|x|twitter|facebook|fb|tiktok|linkedin|youtube|telegram|tg)\s*:/.test(s)) return "PROFILE";
  if (/(instagram\.com|x\.com|twitter\.com|facebook\.com|tiktok\.com|linkedin\.com|youtube\.com|t\.me)\//.test(s)) return "PROFILE";
  if (/play\.google\.com|apps\.apple\.com/.test(s)) return "APP";
  if (/^[a-z][a-z0-9_]*(\.[a-z0-9_]+){2,}$/.test(s) && !/\.(com|net|org|io|app|top|xyz|shop|info|co)$/.test(s)) return "APP";
  if (/^https?:\/\//.test(s) || s.includes("/")) return "WEBSITE";
  return "DOMAIN";
}

export function QuickScan() {
  const router = useRouter();
  const [v, setV] = useState("");
  return (
    <form
      className="flex w-full max-w-md gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const input = v.trim();
        router.push(input ? `/scan?type=${guessType(input)}&input=${encodeURIComponent(input)}` : "/scan");
      }}
    >
      <label htmlFor="quick" className="sr-only">
        Paste an entity to analyse
      </label>
      <input
        id="quick"
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="Paste a URL, domain, handle or package"
        className="min-w-0 flex-1 rounded-md border border-line bg-panel px-3 py-2 font-mono text-sm placeholder:font-sans placeholder:text-faint focus:border-action focus:outline-none"
      />
      <button type="submit" className="rounded-md bg-action px-4 py-2 text-sm font-semibold text-ink hover:bg-[#8bbbea]">
        Analyse
      </button>
    </form>
  );
}
