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
  setSocialRotation,
  markSocialPosted,
  markSocialClosingPosted,
  reorderSocialQueue,
  updateTransactionFields,
} from "./lib/transactions";
import DealPages from "./components/DealPages";
import LoginScreen from "./components/LoginScreen";
import UnderContractForm from "./components/UnderContractForm";
import NewCompForm from "./components/NewCompForm";
import DealDetail from "./components/DealDetail";
import Celebration from "./components/Celebration";
import ManageAgents from "./components/ManageAgents";
import SocialScheduler from "./components/SocialScheduler";
import { SkeletonList } from "./components/Skeleton";
import { LogOut } from "lucide-react";

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
  const [closingTransaction, setClosingTransaction] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [showManageAgents, setShowManageAgents] = useState(false);
  const [showSocialScheduler, setShowSocialScheduler] = useState(false);
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
    if (stage === "contract" || stage === "closed") {
      const tx = txs.find((t) => t.id === id);
      // Leaving the daily social rotation on its own doesn't erase social_went_live_at,
      // which is what still makes it eligible for the one-time closing shoutout.
      if (tx && tx.social_queue_order != null) {
        try {
          await updateTransactionFields(id, { social_queue_order: null });
        } catch (e) {
          console.error("Failed to pull listing out of the social rotation:", e);
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

  async function handleAddTodo(id, text, dueDate) {
    await addTodo(id, text, dueDate);
    loadTransactions({ silent: true });
  }

  async function handleToggleTodo(todo, done) {
    await toggleTodo(todo.id, done);
    // The checkbox itself must always flip and the list must always refresh, even if
    // the Go Live rotation side effect fails (e.g. the social_* columns migration
    // hasn't been run yet) — otherwise one broken side effect makes every checkbox
    // look unresponsive, including ones unrelated to Go Live.
    let sideEffectError = null;
    if (todo.text === "Go Live") {
      try {
        await setSocialRotation(todo.transaction_id, done);
      } catch (e) {
        console.error("Failed to update the social rotation queue:", e);
        sideEffectError = `Checked off, but couldn't update the social rotation queue: ${e.message}`;
      }
    }
    await loadTransactions({ silent: true });
    if (sideEffectError) setError(sideEffectError);
  }

  async function handleMarkSocialPosted(id) {
    await markSocialPosted(id);
    loadTransactions({ silent: true });
  }

  async function handleMarkSocialClosingPosted(id) {
    await markSocialClosingPosted(id);
    loadTransactions({ silent: true });
  }

  async function handleReorderSocialQueue(orderedIds) {
    await reorderSocialQueue(orderedIds);
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

  // Plays the exit animation before actually clearing selectedTransaction, instead of
  // snapping the detail screen away instantly — 200ms matches .deal-detail-exit's CSS
  // transition duration. Shared by the Back button and DealDetail's swipe-left gesture,
  // since both call this same onBack prop.
  function handleCloseDetail() {
    setClosingTransaction(true);
    setTimeout(() => {
      setSelectedTransaction(null);
      setClosingTransaction(false);
    }, 200);
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
        <button onClick={signOut}>
          <LogOut size={16} /> Sign out
        </button>
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

  if (showSocialScheduler) {
    return (
      <div className="app">
        <SocialScheduler
          transactions={txs}
          onBack={() => setShowSocialScheduler(false)}
          onMarkPosted={handleMarkSocialPosted}
          onMarkClosingPosted={handleMarkSocialClosingPosted}
          onReorder={handleReorderSocialQueue}
        />
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
          key={selectedTransaction.id}
          className={closingTransaction ? "deal-detail-exit" : "deal-detail-enter"}
          transaction={selectedTransaction}
          stages={STAGES}
          currentAgent={effectiveAgent}
          onBack={handleCloseDetail}
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
      <header className="main-header">
        <div className="main-header-row">
          <img src="/hall-collins-logo-full.png" alt="Hall Collins Real Estate Group" className="brand-logo" />
          <div className="main-header-right">
            <h1>Deal Flow</h1>
            <button onClick={signOut} aria-label="Sign out" title="Sign out">
              <LogOut size={18} />
            </button>
          </div>
        </div>
        {(isRealBroker || effectiveAgent.role === "broker") && (
          <div className="app-header-actions">
            {isRealBroker && (
              <button onClick={() => setViewAsAgent((v) => !v)}>
                {viewAsAgent ? "View as Broker" : "View as Agent"}
              </button>
            )}
            {effectiveAgent.role === "broker" && <button onClick={() => setShowManageAgents(true)}>Manage Agents</button>}
            {effectiveAgent.role === "broker" && (
              <button onClick={() => setShowSocialScheduler(true)}>Social Scheduler</button>
            )}
          </div>
        )}
      </header>

      {viewAsAgent && (
        <div className="view-as-banner">Viewing as an agent would — showing only your own deals.</div>
      )}

      {error && <div className="error-banner">{error}</div>}

      {loadingTxs ? (
        <SkeletonList count={4} />
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
          onNewComp={() => setShowNewCompForm(true)}
          onNewUnderContract={() => {
            setUnderContractPrefill(null);
            setShowUnderContractForm(true);
          }}
        />
      )}
    </div>
  );
}
