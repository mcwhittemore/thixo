// The base app: navigation, routes and the slots (S1). Ordinary React. The routes are client-side: the shell reads
// the address and listens for `popstate`, which is also what a plugin's `navigate` service fires.

import { useEffect, useState } from "react";
import { AuthoringChat, PluginBrowser, Shell, Slot, useThixo } from "thixo/shell";
import { companies, companyDetail, contactDetail, contacts, dashboardPinned, dashboardPipeline, deals } from "./slots.js";

const USERS = ["rita", "ravi", "mia", "sam", "ada"];

const SECTIONS = [
  { path: "/", label: "Dashboard" },
  { path: "/contacts", label: "Contacts" },
  { path: "/companies", label: "Companies" },
  { path: "/deals", label: "Deals" },
];

function switchUser(name: string) {
  document.cookie = `thixo-user=${encodeURIComponent(name)}; path=/; SameSite=Lax`;
  window.location.reload();
}

function useRoute() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  const go = (to: string) => {
    window.history.pushState({}, "", to);
    setPath(to);
  };
  const [, section = "", id = ""] = path.split("/");
  return { path, go, section, id: decodeURIComponent(id) };
}

function Header(props: { path: string; go: (to: string) => void; browser: boolean; chat: boolean; toggleBrowser: () => void; toggleChat: () => void }) {
  const { user, status, error } = useThixo();
  const here = "/" + (props.path.split("/")[1] ?? "");
  return (
    <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", borderBottom: "1px solid var(--thixo-color-border)" }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>CRM</h1>
      <nav aria-label="Sections" style={{ display: "flex", gap: 12, flex: 1 }}>
        {SECTIONS.map((s) => (
          <a
            key={s.path}
            href={s.path}
            aria-current={here === s.path ? "page" : undefined}
            style={{ fontWeight: here === s.path ? 700 : 400 }}
            onClick={(e) => {
              e.preventDefault();
              props.go(s.path);
            }}
          >
            {s.label}
          </a>
        ))}
      </nav>
      <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
        Signed in as
        <select aria-label="Signed in as" value={user?.id ?? ""} onChange={(e) => switchUser(e.currentTarget.value)}>
          {!user && <option value="">{status === "loading" ? "…" : "nobody"}</option>}
          {USERS.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {status === "error" && <span role="status">{error}: pick a user</span>}
      <button type="button" className="thixo-button" aria-pressed={props.browser} onClick={props.toggleBrowser}>
        Plugins
      </button>
      <button type="button" className="thixo-button" aria-pressed={props.chat} onClick={props.toggleChat}>
        Ask for a plugin
      </button>
    </header>
  );
}

function Dashboard(props: { go: (to: string) => void }) {
  const { user } = useThixo();
  if (user && !user.scopes.includes("deals.read")) {
    return <p role="status">Your role has no dashboard. Contacts and companies are in the menu.</p>;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
      <Slot is={dashboardPipeline} on={{ openStage: () => props.go("/deals") }} />
      <Slot is={dashboardPinned} on={{ open: ({ contactId }) => props.go(`/contacts/${contactId}`) }} />
    </div>
  );
}

export default function App() {
  const { path, go, section, id } = useRoute();
  const [browser, setBrowser] = useState(false);
  const [chat, setChat] = useState(false);

  const panel =
    section === "contacts" && id ? (
      <section aria-label="Selected contact" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button type="button" className="thixo-button" onClick={() => go("/contacts")} style={{ alignSelf: "flex-end" }}>
          Close
        </button>
        <Slot is={contactDetail} context={{ contactId: id }} on={{ openCompany: ({ companyId }) => go(`/companies/${companyId}`) }} />
      </section>
    ) : section === "companies" && id ? (
      <section aria-label="Selected company" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button type="button" className="thixo-button" onClick={() => go("/companies")} style={{ alignSelf: "flex-end" }}>
          Close
        </button>
        <Slot is={companyDetail} context={{ companyId: id }} />
      </section>
    ) : null;

  return (
    <Shell>
      <Header path={path} go={go} browser={browser} chat={chat} toggleBrowser={() => setBrowser((b) => !b)} toggleChat={() => setChat((c) => !c)} />

      <div style={{ display: "flex", gap: 20, padding: 20, alignItems: "flex-start" }}>
        <main style={{ flex: 2, minWidth: 0 }}>
          {section === "" && <Dashboard go={go} />}
          {section === "contacts" && (
            <div style={{ height: "70vh" }}>
              <Slot is={contacts} on={{ select: ({ contactId }) => go(`/contacts/${contactId}`) }} />
            </div>
          )}
          {section === "companies" && (
            <div style={{ height: "70vh" }}>
              <Slot is={companies} on={{ select: ({ companyId }) => go(`/companies/${companyId}`) }} />
            </div>
          )}
          {section === "deals" && (
            <div style={{ height: "70vh" }}>
              <Slot is={deals} />
            </div>
          )}
        </main>

        {(panel || browser || chat) && (
          <aside style={{ flex: 1, minWidth: 280, display: "flex", flexDirection: "column", gap: 16 }}>
            {panel}
            {browser && <PluginBrowser />}
            {chat && <AuthoringChat />}
          </aside>
        )}
      </div>
    </Shell>
  );
}
