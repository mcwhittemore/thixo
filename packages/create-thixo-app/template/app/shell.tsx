// The base app: the always-on functionality and the slots. Write ordinary React. There is no code here to load or wire
// up a plugin; <Slot> does that.

import { useState } from "react";
import { AuthoringChat, PluginBrowser, Shell, Slot, useThixo } from "thixo/shell";
import { main } from "./slots.js";

const USERS = ["ana", "ben"];

/** The app's stand-in login (api/session.ts) reads this cookie. Switching user signs in again from scratch. */
function switchUser(name: string) {
  document.cookie = `thixo-user=${encodeURIComponent(name)}; path=/; SameSite=Lax`;
  window.location.reload();
}

function Header(props: { browser: boolean; chat: boolean; toggleBrowser: () => void; toggleChat: () => void }) {
  const { user, status, error } = useThixo();
  return (
    <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", borderBottom: "1px solid var(--thixo-color-border)" }}>
      <h1 style={{ margin: 0, fontSize: 22, flex: 1 }}>__APP_NAME__</h1>
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

export default function App() {
  const [browser, setBrowser] = useState(false);
  const [chat, setChat] = useState(false);

  return (
    <Shell>
      <Header browser={browser} chat={chat} toggleBrowser={() => setBrowser((b) => !b)} toggleChat={() => setChat((c) => !c)} />

      <div style={{ display: "flex", gap: 20, padding: 20, alignItems: "flex-start" }}>
        <main style={{ flex: 2, minWidth: 0 }}>
          <Slot is={main} />
        </main>

        {(browser || chat) && (
          <aside style={{ flex: 1, minWidth: 280, display: "flex", flexDirection: "column", gap: 16 }}>
            {browser && <PluginBrowser />}
            {chat && <AuthoringChat />}
          </aside>
        )}
      </div>
    </Shell>
  );
}
