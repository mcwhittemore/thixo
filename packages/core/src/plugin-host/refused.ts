/** What the broker rejects with when it will not make a call: the call is not in the plugin's manifest (P1), its
 * author can't make it (P3), the user can't call an optional endpoint (P4), the input is wrong, or the plugin has
 * stopped (P7). `endpoint` names what was asked for: an endpoint, `data.<op>`, `emit.<event>` or a shell service. */
export class ThixoRefused extends Error {
  readonly endpoint: string;
  readonly reason: string;
  constructor(endpoint: string, reason: string) {
    super(`${endpoint} refused: ${reason}`);
    this.name = "ThixoRefused";
    this.endpoint = endpoint;
    this.reason = reason;
  }
}

/** A call the API answered with an error. `status` and `code` come from the reply. */
export class ThixoCallError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ThixoCallError";
    this.status = status;
    this.code = code;
  }
}
