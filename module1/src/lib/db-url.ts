import path from "node:path";

/** Resolves a relative SQLite `file:` URL against the project root so the CLI and the app use the same file. */
export function resolveDatabaseUrl(raw = process.env.DATABASE_URL ?? "file:./prisma/dev.db"): string {
  if (!raw.startsWith("file:")) return raw;
  const p = raw.slice("file:".length);
  return path.isAbsolute(p) ? raw : `file:${path.resolve(process.cwd(), p)}`;
}
