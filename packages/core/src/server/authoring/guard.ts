import { HttpError } from "../../api/errors.js";
import { IMPLEMENTOR, type AuthoringBlock, type AuthoringRefusal, type AuthoringStatus, type RefusalCategory, type RefusalNotice, type User, type UserId } from "../../contract.js";
import type { ServerContext } from "../context.js";

export const DEFAULT_REFUSAL_LIMIT = 3;
export const DEFAULT_REFUSAL_WINDOW_HOURS = 24;
export const GUARD_ADMIN_SCOPE = "thixo.authoring.admin";

/** What each category refuses, as the end of "a plugin that ...". */
export const REFUSAL_CATEGORIES: Record<RefusalCategory, string> = {
  shell: "imitates the app's shell or its own chrome",
  dialog: "imitates a system or browser dialog",
  credentials: "is a sign-in or asks for a password, a code or another secret",
  impersonation: "passes itself off as another plugin or one of the app's defaults",
  override: "tells the agent to skip or loosen its rules",
};

const MAX_TEXT = 2000;
const clip = (text: string) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text);

export interface RefuseInput {
  user: User;
  conversation: string | null;
  category: RefusalCategory;
  reason: string;
  trigger: string;
  quote?: string;
  from: "user" | "data";
  source: "agent" | "check";
}

/** A refusal as the loop and the tools hand it on: the stored notice and the words the person sees. */
export interface RefusalOutcome extends RefusalNotice {
  message: string;
}

export interface AuthoringGuard {
  limit: number;
  windowHours: number;
  /** The block on this user, when one stands. */
  activeBlock(user: UserId): Promise<AuthoringBlock | null>;
  /** Throws 403 `authoring_blocked` for a blocked user. */
  assertAllowed(user: { id: UserId }): Promise<void>;
  status(user: UserId): Promise<AuthoringStatus>;
  /** Stores a refusal, blocks the user at the limit, calls the hook. */
  refuse(input: RefuseInput): Promise<RefusalOutcome>;
  refusals(filter?: { user?: UserId; since?: string }): Promise<AuthoringRefusal[]>;
  /** Blocks that stand, or every block with `all`. */
  blocks(options?: { all?: boolean }): Promise<AuthoringBlock[]>;
  /** Lifts a user's block and starts their count again. `lifted` is false when no block stood. */
  unblock(user: UserId, by: UserId): Promise<{ user: UserId; lifted: boolean; block: AuthoringBlock }>;
}

export function blockedMessage(block: AuthoringBlock): string {
  return `You can no longer make plugins in this app: ${block.reason} You can still use and install plugins. Ask the app's team to lift the block.`;
}

const guards = new WeakMap<ServerContext, AuthoringGuard>();

export function guardOf(ctx: ServerContext): AuthoringGuard {
  let guard = guards.get(ctx);
  if (!guard) {
    guard = createGuard(ctx);
    guards.set(ctx, guard);
  }
  return guard;
}

function createGuard(ctx: ServerContext): AuthoringGuard {
  const config = ctx.config.authoringGuard ?? {};
  const limit = Math.max(0, Math.floor(config.limit ?? DEFAULT_REFUSAL_LIMIT));
  const windowHours = config.windowHours ?? DEFAULT_REFUSAL_WINDOW_HOURS;
  const data = ctx.adapters.data;

  const activeBlock = async (user: UserId) => {
    const block = await data.getAuthoringBlock(user);
    return block && !block.liftedAt ? block : null;
  };

  /** Refusals that count toward a block: the person's own, inside the window, after the last lift. */
  const counted = async (user: UserId, now: Date) => {
    const windowStart = new Date(now.getTime() - windowHours * 3_600_000).toISOString();
    const lifted = (await data.getAuthoringBlock(user))?.liftedAt;
    // A refusal in the same millisecond as the lift came after it (a lift ends the block that refused everything),
    // so the lift's own time is counted from, not past.
    return (await data.listRefusals({ user, since: windowStart })).filter((r) => r.from === "user" && (!lifted || r.at >= lifted));
  };

  const hours = windowHours === 1 ? "an hour" : `${windowHours} hours`;

  return {
    limit,
    windowHours,
    activeBlock,

    async assertAllowed(user) {
      const block = await activeBlock(user.id);
      if (block) throw new HttpError(403, blockedMessage(block), { code: "authoring_blocked", details: { blockedAt: block.at } });
    },

    async status(user) {
      const block = await activeBlock(user);
      // A block replaces the record of the last lift, so while one stands the count is the block's own refusals:
      // counting the window again would take in refusals from before that lift.
      const count = block ? block.refusals.length : (await counted(user, new Date())).length;
      return { blocked: !!block, ...(block ? { message: blockedMessage(block) } : {}), count, limit, windowHours };
    },

    async refuse(input) {
      const now = new Date();
      const refusal: AuthoringRefusal = {
        id: `ref_${crypto.randomUUID()}`,
        user: input.user.id,
        conversation: input.conversation,
        category: input.category,
        reason: clip(input.reason),
        trigger: clip(input.trigger),
        ...(input.quote && input.quote !== input.trigger ? { quote: clip(input.quote) } : {}),
        from: input.from,
        source: input.source,
        at: now.toISOString(),
      };
      await data.addRefusal(refusal);

      const counts = await counted(input.user.id, now);
      const count = counts.length;
      let block: AuthoringBlock | undefined;
      let blocked = false;
      const exempt = input.user.id === IMPLEMENTOR;
      if (limit > 0 && !exempt && input.from === "user" && count >= limit && !(await activeBlock(input.user.id))) {
        block = {
          user: input.user.id,
          at: refusal.at,
          reason: `Thixo's authoring agent refused ${count} of your requests within ${hours}.`,
          refusals: counts.map((r) => r.id),
        };
        await data.putAuthoringBlock(block);
        blocked = true;
      }

      const notice: RefusalNotice = { refusal, count, limit, windowHours, blocked, ...(block ? { block } : {}) };
      try {
        await config.onRefusal?.(notice);
      } catch (error) {
        console.error("authoringGuard.onRefusal failed", error);
      }
      return { ...notice, message: messageFor(notice, exempt) };
    },

    refusals: (filter) => data.listRefusals(filter),

    async blocks(options) {
      const all = await data.listAuthoringBlocks();
      return options?.all ? all : all.filter((b) => !b.liftedAt);
    },

    async unblock(user, by) {
      const now = new Date().toISOString();
      const current = await data.getAuthoringBlock(user);
      const lifted = !!current && !current.liftedAt;
      // With no block standing, a lift still starts the count again, so a person caught by mistake starts clean.
      const block: AuthoringBlock = current && lifted
        ? { ...current, liftedAt: now, liftedBy: by }
        : { user, at: now, reason: "No block stood; the count was started again.", refusals: [], liftedAt: now, liftedBy: by };
      await data.putAuthoringBlock(block);
      return { user, lifted, block };
    },
  };

  function messageFor(notice: RefusalNotice, exempt: boolean): string {
    const what = `Thixo won't make a plugin that ${REFUSAL_CATEGORIES[notice.refusal.category]}.`;
    const reason = notice.refusal.reason.trim();
    const head = `${what}${reason ? ` ${/[.!?]$/.test(reason) ? reason : `${reason}.`}` : ""}`;
    if (notice.refusal.from === "data") return `${head} It came from text the agent read, not from you, so it does not count against you.`;
    if (notice.blocked && notice.block) return `${head} ${blockedMessage(notice.block)}`;
    if (exempt || notice.limit === 0) return head;
    const left = notice.limit - notice.count;
    return `${head} This is refusal ${notice.count} of ${notice.limit} within ${hours}. ${left === 1 ? "One more" : `${left} more`} and you will no longer be able to make plugins in this app.`;
  }
}

export function isCategory(value: unknown): value is RefusalCategory {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(REFUSAL_CATEGORIES, value);
}
