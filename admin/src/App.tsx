import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { supabase } from "./lib/supabase";
import ConfigEditor from "./pages/ConfigEditor";
import Login from "./pages/Login";
import PlansEditor from "./pages/PlansEditor";
import StringsEditor from "./pages/StringsEditor";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setIsAdmin(null);
      return;
    }
    void supabase
      .from("admin_users")
      .select("user_id")
      .eq("user_id", session.user.id)
      .maybeSingle()
      .then(({ data }) => setIsAdmin(Boolean(data)));
  }, [session]);

  if (!session) return <Login />;
  if (isAdmin === null) return <p style={{ padding: 40 }}>Checking access…</p>;
  if (!isAdmin)
    return (
      <div style={{ padding: 40 }}>
        <p>
          This account is not an admin.{" "}
          <button className="ghost" onClick={() => void supabase.auth.signOut()}>
            Sign out
          </button>
        </p>
      </div>
    );

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>
          Pinui<span>+</span> Admin
        </h1>
        <nav>
          <NavLink to="/config">Config</NavLink>
          <NavLink to="/plans">Plans</NavLink>
          <NavLink to="/strings">Strings</NavLink>
        </nav>
        <button className="signout" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </button>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/config" replace />} />
          <Route path="/config" element={<ConfigEditor />} />
          <Route path="/plans" element={<PlansEditor />} />
          <Route path="/strings" element={<StringsEditor />} />
        </Routes>
      </main>
    </div>
  );
}
