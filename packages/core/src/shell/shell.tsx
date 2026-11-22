import * as React from "react";
import type { CreateRuntime } from "thixo-thx/contract";
import type { AppInfo, LayoutReply, User } from "../contract.js";
import type { ShellServiceHost, Tone } from "../plugin-host/services.js";
import { createApi, createClient, type ApiFunction, type Client } from "./client.js";
import { defaultCreateRuntime, defaultLoadModule, type CompiledModule } from "./runtime.js";
import { Session } from "./session.js";
import { SHELL_CSS } from "./styles.js";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ShellProps {
  children?: React.ReactNode;
  /** Where the app's server is. Default: this page's origin. */
  baseUrl?: string;
  /** Exposed libraries (L3) by specifier, as the shell bundle imported them. */
  libraries?: Record<string, Record<string, unknown>>;
  /** Where `navigate` goes: a path inside the app, already checked. Default: `history.pushState` and a `popstate`. */
  onNavigate?: (path: string) => void;
  /** Loops and calls a plugin may run per entry (see the runtime). */
  budget?: number;
  /** For tests and other hosts: the fetch to use, the runtime, and how a compiled module is loaded. */
  fetch?: Fetch;
  createRuntime?: CreateRuntime;
  loadModule?: (code: string, url: string) => Promise<CompiledModule>;
}

export interface ThixoValue {
  /** The signed-in user, or null before sign-in or when signing in failed. */
  user: User | null;
  /** The API SDK (A9), bound to the session: one function per endpoint. Empty until signed in. */
  api: Record<string, ApiFunction>;
  status: "loading" | "ready" | "error";
  error?: string;
}

interface Modal {
  id: number;
  content: unknown;
  title?: string;
  pluginName: string;
  scopeClass: string;
}

interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

/** What `<Slot>`, `<PluginBrowser>` and `<AuthoringChat>` share. Private to the shell: nothing here is ever handed
 * to a plugin, and the token is not in it (P5). */
export interface ShellInternals {
  session: Session;
  client: Client;
  app: AppInfo;
  layout: LayoutReply | undefined;
  layoutError?: string;
  refreshLayout(): Promise<void>;
  browserOpen: boolean;
  setBrowserOpen(open: boolean): void;
  services: ShellServiceHost;
  libraries: Record<string, Record<string, unknown>>;
  budget?: number;
  getCreateRuntime(): Promise<CreateRuntime>;
  loadCode(code: string): Promise<CompiledModule>;
  /** Per version: its `PluginLoad` and module, loaded once per page. */
  cache: Map<string, Promise<unknown>>;
}

const InternalContext = React.createContext<ShellInternals | null>(null);
const PublicContext = React.createContext<ThixoValue>({ user: null, api: {}, status: "loading" });

export function useShellInternals(): ShellInternals | null {
  return React.useContext(InternalContext);
}

/** For the implementor's own shell code: the user and the API SDK bound to the session. */
export function useThixo(): ThixoValue {
  return React.useContext(PublicContext);
}

function defaultNavigate(path: string): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function saveFile(file: { name: string; content: string; mimeType: string }): void {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** The base app's root (S1). It signs in with the page's own session, keeps the token in memory, loads the app and
 * the user's layout, and gives `<Slot>` what it needs to load plugins (S7). */
export function Shell(props: ShellProps) {
  const [state, setState] = React.useState<{ status: "loading" | "ready" | "error"; session?: Session; app?: AppInfo; error?: string }>({ status: "loading" });
  const [layout, setLayout] = React.useState<{ reply?: LayoutReply; error?: string }>({});
  const [browserOpen, setBrowserOpen] = React.useState(false);
  const [modals, setModals] = React.useState<Modal[]>([]);
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const nextId = React.useRef(1);
  const cache = React.useRef(new Map<string, Promise<unknown>>());
  const propsRef = React.useRef(props);
  propsRef.current = props;

  React.useEffect(() => {
    let live = true;
    let session: Session | undefined;
    (async () => {
      session = await Session.start({ baseUrl: props.baseUrl, fetch: props.fetch });
      const app = await createClient(session).app();
      if (!live) return session.end();
      setState({ status: "ready", session, app });
    })().catch((error: unknown) => {
      if (live) setState({ status: "error", error: error instanceof Error ? error.message : String(error) });
    });
    return () => {
      live = false;
      session?.end();
    };
  }, [props.baseUrl, props.fetch]);

  const client = React.useMemo(() => (state.session ? createClient(state.session) : undefined), [state.session]);

  const refreshLayout = React.useCallback(async () => {
    if (!client) return;
    try {
      setLayout({ reply: await client.layout() });
    } catch (error) {
      setLayout((l) => ({ reply: l.reply, error: error instanceof Error ? error.message : String(error) }));
    }
  }, [client]);

  React.useEffect(() => {
    void refreshLayout();
  }, [refreshLayout]);

  const services = React.useMemo<ShellServiceHost>(
    () => ({
      origin: typeof window === "undefined" ? "http://localhost" : window.location.origin,
      navigate: (path) => (propsRef.current.onNavigate ?? defaultNavigate)(path),
      openModal(content, options) {
        const id = nextId.current++;
        setModals((m) => [...m, { id, content, title: options.title, pluginName: options.pluginName, scopeClass: options.scopeClass }]);
        return () => setModals((m) => m.filter((x) => x.id !== id));
      },
      async copyToClipboard(text) {
        await navigator.clipboard.writeText(text);
      },
      download: saveFile,
      toast(message, tone) {
        const id = nextId.current++;
        setToasts((t) => [...t, { id, message, tone }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4_000);
      },
    }),
    [],
  );

  const runtimeOption = props.createRuntime;
  const loadOption = props.loadModule;
  const internals = React.useMemo<ShellInternals | null>(() => {
    if (state.status !== "ready" || !state.session || !state.app || !client) return null;
    const session = state.session;
    return {
      session,
      client,
      app: state.app,
      layout: layout.reply,
      layoutError: layout.error,
      refreshLayout,
      browserOpen,
      setBrowserOpen,
      services,
      libraries: propsRef.current.libraries ?? {},
      budget: propsRef.current.budget,
      cache: cache.current,
      getCreateRuntime: async () => runtimeOption ?? defaultCreateRuntime(),
      loadCode: async (code) => {
        const text = await client.pluginCode(code);
        return (loadOption ?? defaultLoadModule)(text, code);
      },
    };
  }, [state, client, layout, refreshLayout, browserOpen, services, runtimeOption, loadOption]);

  const value = React.useMemo<ThixoValue>(
    () => ({
      user: state.session?.user ?? null,
      api: state.app && state.session ? createApi(state.app, state.session) : {},
      status: state.status,
      ...(state.error ? { error: state.error } : {}),
    }),
    [state],
  );

  return (
    <PublicContext.Provider value={value}>
      <InternalContext.Provider value={internals}>
        <div className="thixo-shell">
          <style>{SHELL_CSS}</style>
          {state.status === "error" && (
            <div role="alert" aria-label="Sign-in problem" className="thixo-slot-message">
              {state.error}
            </div>
          )}
          {props.children}
          {modals.map((m) => (
            <ModalView key={m.id} modal={m} onClose={() => setModals((all) => all.filter((x) => x.id !== m.id))} />
          ))}
          {toasts.length > 0 && (
            <div className="thixo-toasts" aria-live="polite">
              {toasts.map((t) => (
                <div key={t.id} role="status" className={`thixo-toast thixo-tone-${t.tone}`}>
                  {t.message}
                </div>
              ))}
            </div>
          )}
        </div>
      </InternalContext.Provider>
    </PublicContext.Provider>
  );
}

class ModalBoundary extends React.Component<{ name: string; children: React.ReactNode }, { error?: string }> {
  state: { error?: string } = {};
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  render() {
    if (this.state.error) return <div role="alert" className="thixo-slot-message">{`${this.props.name} stopped: ${this.state.error}`}</div>;
    return this.props.children;
  }
}

function ModalView(props: { modal: Modal; onClose: () => void }) {
  const { modal } = props;
  const label = modal.title ?? `${modal.pluginName}`;
  return (
    <div className="thixo-modal-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div role="dialog" aria-modal="true" aria-label={label} className="thixo-modal">
        <header>
          <h2>{label}</h2>
          <button type="button" className="thixo-button" aria-label="Close dialog" onClick={props.onClose}>
            Close
          </button>
        </header>
        <div className={`thixo-slot-box ${modal.scopeClass}`} style={{ contain: "layout paint style", overflow: "auto", isolation: "isolate", position: "relative" }}>
          <ModalBoundary name={modal.pluginName}>{modal.content as React.ReactNode}</ModalBoundary>
        </div>
      </div>
    </div>
  );
}
