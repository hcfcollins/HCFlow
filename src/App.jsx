import { useEffect, useState } from "react";
import { useAuth } from "./lib/useAuth";
import {
  fetchTransactions,
  updateTransactionStage,
  updateTransactionNotes,
} from "./lib/transactions";
import TransactionList from "./components/TransactionList";
import LoginScreen from "./components/LoginScreen";

const STAGES = [
  { key: "comps", label: "Comped" },
  { key: "won", label: "Listing Won" },
  { key: "market", label: "On Market" },
  { key: "contract", label: "Under Contract" },
  { key: "closed", label: "Closed" },
];

export default function App() {
  const { session, agent, loading: authLoading, signInWithGoogle, signOut } = useAuth();
  const [txs, setTxs] = useState([]);
  const [loadingTxs, setLoadingTxs] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (session && agent) loadTransactions();
  }, [session, agent]);

  async function loadTransactions() {
    setLoadingTxs(true);
    try {
      const data = await fetchTransactions();
      setTxs(data);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingTxs(false);
    }
  }

  async function handleStageChange(id, stage) {
    await updateTransactionStage(id, stage);
    loadTransactions();
  }

  async function handleNotesChange(id, notes) {
    await updateTransactionNotes(id, notes);
    loadTransactions();
  }

  if (authLoading) {
    return <div className="center-screen">Loading…</div>;
  }

  if (!session) {
    return <LoginScreen onSignIn={signInWithGoogle} />;
  }

  if (!agent) {
    return (
      <div className="center-screen">
        <p>
          Signed in as <strong>{session.user.email}</strong>, but this account isn't set up as an
          agent yet. Ask Fran or Holly to add you in Manage Agents with this exact email.
        </p>
        <button onClick={signOut}>Sign out</button>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <div className="brand-eyebrow">Hall Collins Real Estate Group</div>
          <h1>Transactions</h1>
        </div>
        <button onClick={signOut}>Sign out</button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {loadingTxs ? (
        <div className="center-screen">Loading transactions…</div>
      ) : (
        <TransactionList
          transactions={txs}
          stages={STAGES}
          currentAgent={agent}
          onStageChange={handleStageChange}
          onNotesChange={handleNotesChange}
        />
      )}
    </div>
  );
}
