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
  seedWonListingTodos,
  createDropboxFolderForListing,
  terminateTransaction,
  reactivateTransaction,
} from "./lib/transactions";
import DealPages, { PAGES } from "./components/DealPages";
import LoginScreen from "./components/LoginScreen";
import UnderContractForm from "./components/UnderContractForm";
import NewCompForm from "./components/NewCompForm";
import DealDetail from "./components/DealDetail";
import Celebration from "./components/Celebration";
import ManageAgents from "./components/ManageAgents";

const STAGES = [
  { key: "comps", label: "Comp" },
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
  const [searchQuery, setSearchQuery] = useState("");
  const [showManageAgents, setShowManageAgents] = useState(false);
  const [viewAsAgent, setViewAsAgent] = useState(false);

  useEffect(() => {
    if (session && agent) loadTransactions();
  }, [session, agent]);

  // `silent` skips the full-screen loading state for refreshes triggered by an
  // edit (toggling a todo, changing notes, etc.) so the screen doesn't flash
  // back to "Loading…" and reset scroll position every time something is saved.
  async function loadTransactions({ silent = false } = {}) {
    if (!silent) setLoadingTxs(true);
    try {
      const data = await fetchTransactions();
      setTxs(data);
      setSelectedTransaction((current) => (current ? data.find((t) => t.id === current.id) || current : current));
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      if (!silent) setLoadingTxs(false);
    }
  }

  async function handleStageChange(id, stage) {
    let sideEffectError = null;
    if (stage === "won") {
      const tx = txs.find((t) => t.id === id);
      // These are gated independently — a transaction can already have todos
      // (seeded on a prior attempt) while still lacking a Dropbox folder if
      // that step failed, so retrying must still re-attempt just that piece.
      if (tx && !tx.todos?.length) {
        try {
          await seedWonListingTodos(id);
        } catch (e) {
          console.error("Failed to seed Won Listing to-dos:", e);
          sideEffectError = `Couldn't set up the to-do checklist: ${e.message}`;
        }
      }
      if (tx && !tx.dropbox_folder_url) {
        try {
          await createDropboxFolderForListing(id);
        } catch (e) {
          console.error("Dropbox folder creation failed:", e);
          sideEffectError = sideEffectError || `Couldn't create the Dropbox folder: ${e.message}`;
        }
      }
    }
    await updateTransactionStage(id, stage);
    // loadTransactions clears any stale error on success, so set ours after it,
    // not before — otherwise the refresh would immediately wipe it out.
    await loadTransactions({ silent: true });
    if (sideEffectError) setError(sideEffectError);
  }

  async function handleNotesChange(id, notes) {
    await updateTransactionNotes(id, notes);
    loadTransactions({ silent: true });
  }

  async function handleCompsStatusChange(id, status) {
    await updateTransactionCompsStatus(id, status);
    loadTransactions({ silent: true });
  }

  async function handleLockboxChange(id, lockboxFields) {
    await updateTransactionLockbox(id, lockboxFields);
    loadTransactions({ silent: true });
  }

  async function handleRetryDropboxFolder(id) {
    try {
      await createDropboxFolderForListing(id);
    } catch (e) {
      console.error("Dropbox folder creation failed:", e);
      await loadTransactions({ silent: true });
      setError(`Couldn't create the Dropbox folder: ${e.message}`);
      return;
    }
    loadTransactions({ silent: true });
  }

  async function handleAddTodo(id, text) {
    await addTodo(id, text);
    loadTransactions({ silent: true });
  }

  async function handleToggleTodo(id, done) {
    await toggleTodo(id, done);
    loadTransactions({ silent: true });
  }

  async function handleTerminate(id, reason) {
    await terminateTransaction(id, reason);
    loadTransactions({ silent: true });
  }

  async function handleReactivate(id) {
    await reactivateTransaction(id);
    loadTransactions({ silent: true });
  }

  function handleRequestUnderContract(tx) {
    setSelectedTransaction(null);
    setUnderContractPrefill(tx);
    setShowUnderContractForm(true);
  }

  /** Shared by the card's inline stage select and the detail screen's stage select. */
  function handleStageChangeRequest(tx, newStage) {
    if (newStage === "contract" && tx.stage !== "contract") {
      handleRequestUnderContract(tx);
    } else {
      handleStageChange(tx.id, newStage);
    }
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

  // A broker previewing "View as Agent" gets an agent object with the same real id
  // (writes still attribute correctly) but role: "agent", so every existing
  // `isBroker = currentAgent.role === "broker"` check throughout the app already
  // reacts correctly with no per-component changes needed.
  const isRealBroker = agent.role === "broker";
  const effectiveAgent = viewAsAgent ? { ...agent, role: "agent" } : agent;

  if (showUnderContractForm) {
    return (
      <div className="app">
        <UnderContractForm
          currentAgent={effectiveAgent}
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

  if (showManageAgents) {
    return (
      <div className="app">
        <ManageAgents onBack={() => setShowManageAgents(false)} />
      </div>
    );
  }

  if (showNewCompForm) {
    return (
      <div className="app">
        <NewCompForm
          currentAgent={effectiveAgent}
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
        {error && <div className="error-banner">{error}</div>}
        <DealDetail
          transaction={selectedTransaction}
          stages={STAGES}
          currentAgent={effectiveAgent}
          onBack={() => setSelectedTransaction(null)}
          onStageChange={handleStageChangeRequest}
          onNotesChange={handleNotesChange}
          onCompsStatusChange={handleCompsStatusChange}
          onAddTodo={handleAddTodo}
          onToggleTodo={handleToggleTodo}
          onLockboxChange={handleLockboxChange}
          onRefresh={() => loadTransactions({ silent: true })}
          onRetryDropboxFolder={handleRetryDropboxFolder}
          onTerminate={handleTerminate}
          onReactivate={handleReactivate}
        />
      </div>
    );
  }

  const onCompsPage = PAGES[pageIndex]?.key === "comps";
  // A broker previewing "as agent" should see exactly what that agent would see —
  // just their own deals — same as RLS would actually enforce for a real agent.
  const visibleTxs = viewAsAgent ? txs.filter((tx) => tx.agent_id === agent.id) : txs;
  const trimmedQuery = searchQuery.trim().toLowerCase();
  const isSearching = trimmedQuery.length > 0;
  const searchResults = isSearching
    ? visibleTxs.filter((tx) =>
        [tx.address, tx.seller_name, tx.buyer_name].some((field) => field?.toLowerCase().includes(trimmedQuery))
      )
    : [];

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand-block">
          <img src="/logo-mark.png" alt="Hall Collins Real Estate Group" className="brand-logo" />
          <h1>Deal Tracker</h1>
        </div>
        <div className="app-header-actions">
          {isRealBroker && (
            <button onClick={() => setViewAsAgent((v) => !v)}>
              {viewAsAgent ? "View as Broker" : "View as Agent"}
            </button>
          )}
          {effectiveAgent.role === "broker" && <button onClick={() => setShowManageAgents(true)}>Manage Agents</button>}
          <button onClick={signOut}>Sign out</button>
        </div>
      </header>

      {viewAsAgent && (
        <div className="view-as-banner">Viewing as an agent would — showing only your own deals.</div>
      )}

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
          transactions={visibleTxs}
          stages={STAGES}
          currentAgent={effectiveAgent}
          onStageChange={handleStageChangeRequest}
          onNotesChange={handleNotesChange}
          onCompsStatusChange={handleCompsStatusChange}
          onAddTodo={handleAddTodo}
          onToggleTodo={handleToggleTodo}
          onOpenDetail={setSelectedTransaction}
          pageIndex={pageIndex}
          onPageIndexChange={setPageIndex}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          isSearching={isSearching}
          searchResults={searchResults}
        />
      )}
    </div>
  );
}
