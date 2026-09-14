import { useEffect, useState } from "react";
import { useAuth } from "./lib/useAuth";
import {
  fetchTransactions,
  updateTransactionStage,
  updateTransactionNotes,
  updateTransactionCompsStatus,
  updateTransactionLockbox,
  addTodo,
  toggleTodo,
} from "./lib/transactions";
import DealPages, { PAGES } from "./components/DealPages";
import LoginScreen from "./components/LoginScreen";
import UnderContractForm from "./components/UnderContractForm";
import NewCompForm from "./components/NewCompForm";
import DealDetail from "./components/DealDetail";
import Celebration from "./components/Celebration";

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
  const [showUnderContractForm, setShowUnderContractForm] = useState(false);
  const [underContractPrefill, setUnderContractPrefill] = useState(null);
  const [showNewCompForm, setShowNewCompForm] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);

  useEffect(() => {
    if (session && agent) loadTransactions();
  }, [session, agent]);

  async function loadTransactions() {
    setLoadingTxs(true);
    try {
      const data = await fetchTransactions();
      setTxs(data);
      setSelectedTransaction((current) => (current ? data.find((t) => t.id === current.id) || current : current));
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

  async function handleCompsStatusChange(id, status) {
    await updateTransactionCompsStatus(id, status);
    loadTransactions();
  }

  async function handleLockboxChange(id, lockboxFields) {
    await updateTransactionLockbox(id, lockboxFields);
    loadTransactions();
  }

  async function handleAddTodo(id, text) {
    await addTodo(id, text);
    loadTransactions();
  }

  async function handleToggleTodo(id, done) {
    await toggleTodo(id, done);
    loadTransactions();
  }

  function handleRequestUnderContract(tx) {
    setSelectedTransaction(null);
    setUnderContractPrefill(tx);
    setShowUnderContractForm(true);
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

  if (showUnderContractForm) {
    return (
      <div className="app">
        <UnderContractForm
          currentAgent={agent}
          initialData={underContractPrefill}
          onCancel={() => {
            setShowUnderContractForm(false);
            setUnderContractPrefill(null);
          }}
          onSubmitted={() => {
            setShowUnderContractForm(false);
            setUnderContractPrefill(null);
            setShowCelebration(true);
            loadTransactions();
          }}
        />
        {showCelebration && <Celebration onDone={() => setShowCelebration(false)} />}
      </div>
    );
  }

  if (showNewCompForm) {
    return (
      <div className="app">
        <NewCompForm
          currentAgent={agent}
          onCancel={() => setShowNewCompForm(false)}
          onSubmitted={() => {
            setShowNewCompForm(false);
            loadTransactions();
          }}
        />
      </div>
    );
  }

  if (selectedTransaction) {
    return (
      <div className="app">
        <DealDetail
          transaction={selectedTransaction}
          stages={STAGES}
          currentAgent={agent}
          onBack={() => setSelectedTransaction(null)}
          onStageChange={handleStageChange}
          onRequestUnderContract={handleRequestUnderContract}
          onNotesChange={handleNotesChange}
          onCompsStatusChange={handleCompsStatusChange}
          onAddTodo={handleAddTodo}
          onToggleTodo={handleToggleTodo}
          onLockboxChange={handleLockboxChange}
        />
      </div>
    );
  }

  const onCompsPage = PAGES[pageIndex]?.key === "comps";

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

      <button
        className={`google-btn uc-launch ${onCompsPage ? "uc-launch--comps" : "uc-launch--contract"}`}
        onClick={() => {
          if (onCompsPage) {
            setShowNewCompForm(true);
          } else {
            setUnderContractPrefill(null);
            setShowUnderContractForm(true);
          }
        }}
      >
        {onCompsPage ? "+ New Comp" : "+ Under Contract"}
      </button>

      {loadingTxs ? (
        <div className="center-screen">Loading transactions…</div>
      ) : (
        <DealPages
          transactions={txs}
          stages={STAGES}
          currentAgent={agent}
          onStageChange={handleStageChange}
          onNotesChange={handleNotesChange}
          onCompsStatusChange={handleCompsStatusChange}
          onAddTodo={handleAddTodo}
          onToggleTodo={handleToggleTodo}
          onOpenDetail={setSelectedTransaction}
          pageIndex={pageIndex}
          onPageIndexChange={setPageIndex}
        />
      )}
    </div>
  );
}
