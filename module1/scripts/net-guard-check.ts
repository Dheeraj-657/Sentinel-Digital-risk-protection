/**
 * SSRF regression checks for src/lib/engine/net-guard.ts (run by `npm run test:engine`).
 * Uses a local HTTP server only; no external network.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { assertFetchableUrl, guardedRequest, isNonPublicIp } from "../src/lib/engine/net-guard";

export async function netGuardChecks(): Promise<number> {
  let failures = 0;
  const ok = (pass: boolean, name: string, extra = "") => {
    if (!pass) failures++;
    console.log(`${pass ? "✔" : "✘"} net-guard: ${name}${extra ? ` (${extra})` : ""}`);
  };

  // 1. Address classifier
  const blocked = [
    "127.0.0.1", "127.255.255.254", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.10", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1",
    "::", "::1", "[::1]", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:192.168.1.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe",
    "::127.0.0.1", "64:ff9b::7f00:1", "64:ff9b::a00:1", "2002:7f00:1::", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%eth0",
    "fec0::1", "ff02::1", "2001:db8::1", "not-an-ip",
  ];
  const allowed = ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "64:ff9b::808:808"];
  for (const ip of blocked) ok(isNonPublicIp(ip), `blocks ${ip}`);
  for (const ip of allowed) ok(!isNonPublicIp(ip), `allows ${ip}`);

  // 2. Per-hop URL validation
  for (const u of ["file:///etc/passwd", "gopher://x.example/", "ftp://x.example/", "http://user:pw@x.example/", "http://localhost:3000/", "http://[::ffff:127.0.0.1]/", "http://0x7f000001/"]) {
    let threw = false;
    try {
      assertFetchableUrl(u);
    } catch {
      threw = true;
    }
    ok(threw, `rejects URL ${u}`);
  }

  // 3. Live redirect handling against a local server. The test policy treats
  //    127.0.0.1 as "public" so the first hop can connect; everything else uses
  //    the production classifier.
  const server = http.createServer((req, res) => {
    const port = (server.address() as AddressInfo).port;
    const go = (loc: string) => {
      res.writeHead(302, { location: loc });
      res.end();
    };
    if (req.url === "/to-metadata") return go("http://169.254.169.254/latest/meta-data/");
    if (req.url === "/to-private-name") return go(`http://internal.test:${port}/ok`);
    if (req.url === "/to-file") return go("file:///etc/passwd");
    if (req.url === "/to-mapped") return go("http://[::ffff:10.0.0.1]/");
    if (req.url === "/to-ok") return go(`http://public.test:${port}/ok`);
    if (req.url === "/loop") return go("/loop");
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<title>ok</title>");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const resolver = async (host: string) =>
    host === "public.test"
      ? [{ address: "127.0.0.1", family: 4 }]
      : host === "internal.test"
        ? [{ address: "10.0.0.1", family: 4 }]
        : host === "mixed.test"
          ? [{ address: "127.0.0.1", family: 4 }, { address: "192.168.1.1", family: 4 }]
          : [];
  const testPolicy = (ip: string) => ip !== "127.0.0.1" && isNonPublicIp(ip);
  const base = `http://public.test:${port}`;
  const run = (path: string, host = base) =>
    guardedRequest(`${host}${path}`, { resolver, isBlockedIp: testPolicy, timeoutMs: 3000, maxHops: 4 });

  const good = await run("/to-ok").catch((e: Error) => e);
  ok(!(good instanceof Error) && good.body.includes("ok") && good.chain.length === 2, "follows a public→public redirect");

  for (const [path, why] of [
    ["/to-metadata", "redirect to cloud metadata IP"],
    ["/to-private-name", "redirect to a hostname that resolves to 10.0.0.1"],
    ["/to-file", "redirect to file: scheme"],
    ["/to-mapped", "redirect to IPv4-mapped private IPv6"],
    ["/loop", "redirect loop"],
  ] as const) {
    const r = await run(path).catch((e: Error) => e);
    ok(r instanceof Error, `blocks ${why}`, r instanceof Error ? r.message : "fetched!");
  }
  const mixed = await run("/ok", `http://mixed.test:${port}`).catch((e: Error) => e);
  ok(mixed instanceof Error, "blocks a DNS answer containing any private address");
  // Production policy: even the loopback test server itself is unreachable.
  const real = await guardedRequest(`http://127.0.0.1:${port}/ok`, { timeoutMs: 2000 }).catch((e: Error) => e);
  ok(real instanceof Error, "production policy refuses 127.0.0.1");
  const viaDns = await guardedRequest(`http://public.test:${port}/ok`, { resolver, timeoutMs: 2000 }).catch((e: Error) => e);
  ok(viaDns instanceof Error, "production policy refuses a name resolving to 127.0.0.1 (pinned lookup)");

  server.close();
  return failures;
}
