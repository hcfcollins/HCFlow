import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

/**
 * Handles Google sign-in via Supabase Auth, and looks up the matching row
 * in the `agents` table (by email) so the app knows the user's name and role.
 */
export function useAuth() {
  const [session, setSession] = useState(null);
  const [agent, setAgent] = useState(null); // row from `agents` table
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadAgent(session.user.email);
      else setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) loadAgent(session.user.email);
      else {
        setAgent(null);
        setLoading(false);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function loadAgent(email) {
    setLoading(true);
    const { data, error } = await supabase
      .from("agents")
      .select("*")
      .eq("email", email)
      .single();

    if (error) {
      // No matching agent row yet — this account isn't provisioned in the team roster.
      console.warn("No agent record found for", email, error.message);
      setAgent(null);
    } else {
      setAgent(data);
    }
    setLoading(false);
  }

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return { session, agent, loading, signInWithGoogle, signOut };
}
