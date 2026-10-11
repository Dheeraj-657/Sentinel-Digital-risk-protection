import type { M1EntityType } from "./types";

const SOCIAL_HOSTS = /(^|\.)(instagram\.com|x\.com|twitter\.com|facebook\.com|fb\.com|tiktok\.com|linkedin\.com|youtube\.com|t\.me|telegram\.me)$/i;
const STORE_HOSTS = /(^|\.)(play\.google\.com|apps\.apple\.com)$/i;

/**
 * Best-effort guess of what an analyst pasted, so one box can take a URL,
 * profile, app or domain. Only a UI default — Module 1 validates the input
 * and the analyst can override the type.
 */
export function guessScanType(raw: string): M1EntityType {
  const value = raw.trim();
  if (/^@\w|^[a-z]+:@?\w+$/i.test(value)) return "PROFILE"; // @handle or platform:handle
  let host = "";
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`).hostname;
  } catch {
    return "WEBSITE";
  }
  if (SOCIAL_HOSTS.test(host)) return "PROFILE";
  if (STORE_HOSTS.test(host)) return "APP";
  // Reverse-DNS package names (com.brand.app) have no scheme, no path and ≥3 labels.
  if (!/[/:]/.test(value) && /^[a-z][\w]*(\.[a-z][\w]*){2,}$/i.test(value) && /^(com|org|net|io|app|co|in|me)\./i.test(value)) {
    return "APP";
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.includes("/")) return "WEBSITE";
  return "DOMAIN";
}
