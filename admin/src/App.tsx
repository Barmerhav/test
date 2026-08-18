import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { supabase } from "./lib/supabase";
import Buildings from "./pages/Buildings";
import ConfigEditor from "./pages/ConfigEditor";
import Credits from "./pages/Credits";
import KillSwitches from "./pages/KillSwitches";
import Login from "./pages/Login";
import Metrics from "./pages/Metrics";
import Payouts from "./pages/Payouts";
import PickersQueue from "./pages/PickersQueue";
import PlansEditor from "./pages/PlansEditor";
import RequestsBoard from "./pages/RequestsBoard";
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
          <NavLink to="/board">Live board</NavLink>
          <NavLink to="/metrics">Metrics</NavLink>
          <NavLink to="/config">Config</NavLink>
          <NavLink to="/plans">Plans</NavLink>
          <NavLink to="/strings">Strings</NavLink>
          <NavLink to="/pickers">Pickers</NavLink>
          <NavLink to="/buildings">Buildings</NavLink>
          <NavLink to="/payouts">Payouts</NavLink>
          <NavLink to="/credits">Credits</NavLink>
          <NavLink to="/switches">Kill switches</NavLink>
        </nav>
        <button className="signout" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </button>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/board" replace />} />
          <Route path="/board" element={<RequestsBoard />} />
          <Route path="/metrics" element={<Metrics />} />
          <Route path="/config" element={<ConfigEditor />} />
          <Route path="/plans" element={<PlansEditor />} />
          <Route path="/strings" element={<StringsEditor />} />
          <Route path="/pickers" element={<PickersQueue />} />
          <Route path="/buildings" element={<Buildings />} />
          <Route path="/payouts" element={<Payouts />} />
          <Route path="/credits" element={<Credits />} />
          <Route path="/switches" element={<KillSwitches />} />
        </Routes>
      </main>
    </div>
  );
}
