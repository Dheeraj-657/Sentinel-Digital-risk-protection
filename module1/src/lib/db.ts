import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { resolveDatabaseUrl } from "./db-url";

const g = globalThis as unknown as { __prisma?: PrismaClient };

function create() {
  const url = resolveDatabaseUrl();
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
}

export const prisma = g.__prisma ?? create();
if (process.env.NODE_ENV !== "production") g.__prisma = prisma;
