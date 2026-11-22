import type { TokenReply, User } from "../contract.js";
import type { AuthorizedRequest } from "../plugin-host/broker.js";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

interface Held {
  token: string;
  expiresAt: number;
  timer?: ReturnType<typeof setTimeout>;
  pending?: Promise<void>;
}

/** The token lives here and nowhere else: not on the session object, not on window, not in storage, not in React
 * context (P5). Only this module reads it. */
const held = new WeakMap<Session, Held>();

/** Refresh this long before the token expires. */
const REFRESH_EARLY_MS = 60_000;

export class SessionError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "SessionError";
    this.status = status;
  }
}

/** The user's session with Thixo: a token traded for the page's own session (A4), kept in memory and refreshed
 * before it expires. `request` is the one way to use it. */
export class Session {
  readonly user: User;
  readonly baseUrl: string;
  private readonly fetchFn: Fetch;
  private stopped = false;

  private constructor(user: User, baseUrl: string, fetchFn: Fetch) {
    this.user = user;
    this.baseUrl = baseUrl;
    this.fetchFn = fetchFn;
  }

  /** Trades the page's session (its cookies, same origin) for a token. */
  static async start(options: { baseUrl?: string; fetch?: Fetch } = {}): Promise<Session> {
    const baseUrl = options.baseUrl ?? "";
    const fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
    const reply = await fetchToken(fetchFn, baseUrl);
    const session = new Session(reply.user, baseUrl, fetchFn);
    held.set(session, { token: reply.token, expiresAt: Date.parse(reply.expiresAt) });
    session.schedule();
    return session;
  }

  /** A request to the app's server with the token attached. A 401 refreshes the token once and tries again. */
  readonly request: AuthorizedRequest = async (path, init) => {
    if (this.stopped) throw new SessionError("The session has ended", 0);
    await this.fresh();
    const first = await this.send(path, init);
    if (first.status !== 401) return first;
    await this.refresh();
    return this.send(path, init);
  };

  /** A request with no token, such as `GET /_thixo/app`. */
  readonly plain = (path: string, init?: RequestInit) => this.fetchFn(this.baseUrl + path, { credentials: "same-origin", ...init });

  /** Stops refreshing. Later requests fail. */
  end(): void {
    this.stopped = true;
    const h = held.get(this);
    if (h?.timer) clearTimeout(h.timer);
    held.delete(this);
  }

  private send(path: string, init: RequestInit): Promise<Response> {
    const h = held.get(this);
    if (!h) throw new SessionError("The session has ended", 0);
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${h.token}`);
    return this.fetchFn(this.baseUrl + path, { ...init, headers, credentials: "same-origin" });
  }

  private async fresh(): Promise<void> {
    const h = held.get(this);
    if (h && h.expiresAt - Date.now() < 5_000) await this.refresh();
  }

  private refresh(): Promise<void> {
    const h = held.get(this);
    if (!h) return Promise.reject(new SessionError("The session has ended", 0));
    if (!h.pending) {
      h.pending = fetchToken(this.fetchFn, this.baseUrl)
        .then((reply) => {
          h.token = reply.token;
          h.expiresAt = Date.parse(reply.expiresAt);
          this.schedule();
        })
        .finally(() => {
          h.pending = undefined;
        });
    }
    return h.pending;
  }

  private schedule(): void {
    const h = held.get(this);
    if (!h || this.stopped) return;
    if (h.timer) clearTimeout(h.timer);
    const wait = Math.max(1_000, h.expiresAt - Date.now() - REFRESH_EARLY_MS);
    h.timer = setTimeout(() => {
      this.refresh().catch(() => undefined);
    }, wait);
    (h.timer as { unref?: () => void }).unref?.();
  }
}

async function fetchToken(fetchFn: Fetch, baseUrl: string): Promise<TokenReply> {
  const response = await fetchFn(`${baseUrl}/_thixo/token`, { method: "POST", credentials: "same-origin", headers: { accept: "application/json" } });
  if (!response.ok) {
    let message = `Signing in failed with ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // Not JSON: keep the status.
    }
    throw new SessionError(message, response.status);
  }
  return (await response.json()) as TokenReply;
}
