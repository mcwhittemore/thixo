// The fetch behind copy at build. The server fetches an address a plugin's author wrote, on that author's behalf, so
// it must not be a way to reach inside the network the server sits in: https only, on port 443; every host resolved
// and refused when any of its addresses is loopback, private, link-local, a cloud metadata address or otherwise not on
// the public internet; the connection pinned to the address that was checked (no second lookup to rebind); the same
// again after each redirect, of which there are few; a timeout; a size cap; and images and fonts only.

import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { AssetLimits, FetchedAsset } from "thixo/contract";

/** What `get` hands back: the status, the headers (lower-cased names), and the body as it arrives. */
export interface RawResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  /** Stops reading and closes the connection. */
  destroy(): void;
}

export interface GuardedFetchOptions {
  /** Every address a host name resolves to. Default: the system resolver. Tests pass their own. */
  resolve?(hostname: string): Promise<string[]>;
  /** One GET of `url`, connecting to `address` (already checked) and nowhere else. Default: `node:https`, with TLS
   * checked against the host name. Tests pass their own, so they never touch the network. */
  get?(url: URL, address: string, signal: AbortSignal): Promise<RawResponse>;
  /** The whole fetch, redirects included. Default 10 seconds. */
  timeoutMs?: number;
  /** Default 3. */
  maxRedirects?: number;
}

export type AssetFetch = (address: string, limits: AssetLimits) => Promise<FetchedAsset>;

class Refused extends Error {}

// ---- Which addresses are on the public internet ----

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((n, part) => n * 256 + Number(part), 0);
}

/** IPv4 ranges that are not the public internet: this network, private, shared (CGNAT), loopback, link-local (and
 * the 169.254.169.254 metadata address in it), IETF, documentation, benchmarking, multicast, reserved, broadcast. */
const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function v4Public(ip: string): boolean {
  const n = v4ToInt(ip);
  return !V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === ((v4ToInt(base) & mask) >>> 0);
  });
}

function v6ToBigInt(ip: string): bigint {
  let text = ip.toLowerCase().replace(/%.*$/, "");
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (v4) {
    const n = v4ToInt(v4[1]);
    text = `${text.slice(0, v4.index)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = text.includes("::") ? text.split("::") : [text, undefined];
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  return groups.reduce((n, g) => (n << 16n) | BigInt(parseInt(g || "0", 16)), 0n);
}

/** IPv6 ranges that are not the public internet, or that carry an IPv4 address inside them (mapped, NAT64, 6to4,
 * Teredo), which is refused rather than unpacked. */
const V6_BLOCKED: [string, number][] = [
  ["::", 96],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
];

function v6Public(ip: string): boolean {
  const n = v6ToBigInt(ip);
  return !V6_BLOCKED.some(([base, bits]) => {
    const shift = BigInt(128 - bits);
    return n >> shift === v6ToBigInt(base) >> shift;
  });
}

/** True when `ip` is an address on the public internet. Anything else, or anything that is not an address, is false. */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip.replace(/%.*$/, ""));
  if (kind === 4) return v4Public(ip);
  if (kind === 6) return v6Public(ip);
  return false;
}

// ---- The fetch ----

async function systemResolve(hostname: string): Promise<string[]> {
  const found = await dnsLookup(hostname, { all: true, verbatim: true });
  return found.map((a) => a.address);
}

function systemGet(url: URL, address: string, signal: AbortSignal): Promise<RawResponse> {
  return new Promise((ok, fail) => {
    const family = isIP(address);
    const req = httpsRequest(
      {
        host: url.hostname.replace(/^\[|\]$/g, ""),
        servername: isIP(url.hostname.replace(/^\[|\]$/g, "")) ? undefined : url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { accept: "image/*, font/*", "user-agent": "thixo-build (copy at build)" },
        signal,
        // The connection goes to the address that was checked, whatever the resolver says now.
        lookup: ((_host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
          if (options?.all) callback(null, [{ address, family }]);
          else callback(null, address, family);
        }) as never,
      },
      (res) => {
        const headers: Record<string, string | undefined> = {};
        for (const [name, value] of Object.entries(res.headers)) headers[name] = Array.isArray(value) ? value.join(", ") : value;
        ok({ status: res.statusCode ?? 0, headers, body: res, destroy: () => res.destroy() });
      },
    );
    req.on("error", fail);
    req.end();
  });
}

/** The fetcher `localBuild` uses for copy at build. Every refusal is a sentence the authoring agent can act on. */
export function guardedFetch(options: GuardedFetchOptions = {}): AssetFetch {
  const resolve = options.resolve ?? systemResolve;
  const get = options.get ?? systemGet;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxRedirects = options.maxRedirects ?? 3;

  async function pinned(url: URL): Promise<string> {
    if (url.protocol !== "https:") throw new Refused(`only https addresses are copied, and this one ${url.protocol === "http:" ? "is" : "goes to"} ${url.protocol}//.`);
    if (url.username || url.password) throw new Refused("an address with a user name or password is not copied.");
    if (url.port && url.port !== "443") throw new Refused(`only the standard https port is copied from, not port ${url.port}.`);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (!host) throw new Refused("the address has no host.");
    if (isIP(host)) {
      if (!isPublicAddress(host)) throw new Refused(`${host} is not an address on the public internet.`);
      return host;
    }
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Refused(`${host} is not a public host.`);
    let addresses: string[];
    try {
      addresses = await resolve(host);
    } catch {
      throw new Refused(`${host} could not be found.`);
    }
    if (!addresses.length) throw new Refused(`${host} could not be found.`);
    const inside = addresses.find((a) => !isPublicAddress(a));
    if (inside) throw new Refused(`${host} resolves to ${inside}, which is not an address on the public internet.`);
    return addresses[0];
  }

  return async function fetchAsset(address, limits) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: RawResponse | undefined;
    try {
      let url: URL;
      try {
        url = new URL(address);
      } catch {
        throw new Refused("it is not a full address.");
      }
      for (let redirects = 0; ; redirects++) {
        const ip = await pinned(url);
        response = await get(url, ip, controller.signal);
        if (response.status >= 300 && response.status < 400 && response.headers.location) {
          response.destroy();
          if (redirects >= maxRedirects) throw new Refused(`it redirected more than ${maxRedirects} times.`);
          try {
            url = new URL(response.headers.location, url);
          } catch {
            throw new Refused("it redirected to something that is not an address.");
          }
          continue;
        }
        break;
      }
      if (response.status !== 200) throw new Refused(`the host answered ${response.status}.`);
      const contentType = (response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (!limits.types.includes(contentType)) throw new Refused(`it is served as ${contentType || "no type"}, and only images and fonts are copied.`);
      const declared = Number(response.headers["content-length"]);
      if (Number.isFinite(declared) && declared > limits.maxBytes) throw new Refused(`it is ${declared} bytes, more than the ${limits.maxBytes} a plugin may still copy.`);
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > limits.maxBytes) throw new Refused(`it is larger than the ${limits.maxBytes} bytes a plugin may still copy.`);
        chunks.push(chunk);
      }
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.byteLength;
      }
      return { ok: true, bytes, contentType };
    } catch (error) {
      response?.destroy();
      if (error instanceof Refused) return { ok: false, message: error.message };
      if (controller.signal.aborted) return { ok: false, message: `it took longer than ${Math.round(timeoutMs / 1000)} seconds.` };
      return { ok: false, message: `the fetch failed: ${error instanceof Error ? error.message : String(error)}.` };
    } finally {
      clearTimeout(timer);
    }
  };
}
