import { useEffect, useRef, useState } from "react";
import { useAuth } from "./lib/useAuth";
import {
  fetchTransactions,
  updateTransactionStage,
  updateTransactionNotes,
  updateTransactionCompsStatus,
  updateTransactionLockbox,
  addTodo,
  toggleTodo,
  updateTodo,
  deleteTodo,
  seedWonListingTodos,
  createDropboxFolderForListing,
  createDropboxFolderForBuyer,
  terminateTransaction,
  reactivateTransaction,
  relistAfterTermination,
  setSocialRotation,
  markSocialPosted,
  markSocialClosingPosted,
  reorderSocialQueue,
  updateTransactionFields,
  notifyTodo,
  todoHasMention,
  setReadyForCloseout,
  sendTestDailyDigest,
  initialsFor,
  backfillDropboxFolderIds,
  fillAllZipCodes,
} from "./lib/transactions";
import { TodoActionsContext } from "./lib/TodoActionsContext";
import { buildUtilityEmail, openEmailCompose } from "./lib/clientEmail";
import ActiveListingForm from "./components/ActiveListingForm";
import { useMentionRoster } from "./lib/mentions";
import { Bell, Mail } from "lucide-react";
// Bumped automatically on every commit by .githooks/pre-commit.
import versionInfo from "./version.json";
import { useToast } from "./lib/ToastContext";
import NotificationBell from "./components/NotificationBell";
import DealPages, { AllPage } from "./components/DealPages";
import LoginScreen from "./components/LoginScreen";
import UnderContractForm from "./components/UnderContractForm";
import NewCompForm from "./components/NewCompForm";
import DealDetail from "./components/DealDetail";
import Celebration from "./components/Celebration";
import ManageAgents from "./components/ManageAgents";
import SocialScheduler from "./components/SocialScheduler";
import SpreadsheetView from "./components/SpreadsheetView";
import TutorialGuide from "./components/TutorialGuide";
import AgentSpreadsheetView from "./components/AgentSpreadsheetView";
import { SkeletonList } from "./components/Skeleton";
import { LogOut, HelpCircle, ArrowLeft } from "lucide-react";

const STAGES = [
  { key: "comps", label: "Comp" },
  { key: "won", label: "Listing Won" },
  { key: "market", label: "On Market" },
  { key: "contract", label: "Under Contract" },
  { key: "closed", label: "Closed" },
];

// Agents and the transaction coordinator can't close a deal themselves — only
// a broker does, after reviewing the commission in the Close-Out Calculator.
// They get "Ready for Closeout" instead (an Under Contract deal with
// ready_for_closeout_at set, not a real stage), and Closed stays in the list
// only so an already-closed deal still displays correctly.
const NON_BROKER_STAGES = [
  ...STAGES.filter((s) => s.key !== "closed"),
  { key: "ready_closeout", label: "Ready for Closeout" },
  { key: "closed", label: "Closed", disabled: true },
];

export default function App() {
  const { session, agent, loading: authLoading, signInWithGoogle, signOut } = useAuth();
  const [txs, setTxs] = useState([]);
  const [loadingTxs, setLoadingTxs] = useState(true);
  const [error, setError] = useState(null);
  const [showUnderContractForm, setShowUnderContractForm] = useState(false);
  const [underContractPrefill, setUnderContractPrefill] = useState(null);
  const [showNewCompForm, setShowNewCompForm] = useState(false);
  const [showActiveListingForm, setShowActiveListingForm] = useState(false);
  const [notifyingTodoId, setNotifyingTodoId] = useState(null);
  const [remindMenuTodoId, setRemindMenuTodoId] = useState(null); // which to-do's "remind who?" menu is open
  const mentionRoster = useMentionRoster();

  // Tap anywhere outside an open "remind who?" menu to close it.
  useEffect(() => {
    if (!remindMenuTodoId) return;
    const close = (e) => {
      if (!e.target.closest?.(".remind-wrap")) setRemindMenuTodoId(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, [remindMenuTodoId]);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [closingTransaction, setClosingTransaction] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [pageIndex, setPageIndex] = useState(2); // Under Contract — see PAGES in DealPages.jsx
  const [searchQuery, setSearchQuery] = useState("");
  const [showManageAgents, setShowManageAgents] = useState(false);
  const [showSocialScheduler, setShowSocialScheduler] = useState(false);
  const [showSpreadsheetView, setShowSpreadsheetView] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showMySpreadsheet, setShowMySpreadsheet] = useState(false);
  const [showAllDeals, setShowAllDeals] = useState(false);
  // Broker-only previews: null (normal), "agent", or "coordinator" (TC View).
  const [viewAs, setViewAs] = useState(null);
  const viewAsAgent = viewAs === "agent";
  const [sendingTestDigest, setSendingTestDigest] = useState(false);
  const showToast = useToast();

  useEffect(() => {
    if (session && agent) loadTransactions();
  }, [session, agent]);

  // `silent` skips the full-screen loading state for refreshes triggered by an
  // edit (toggling a todo, changing notes, etc.) so the screen doesn't flash
  // back to "Loading…" and reset scroll position every time something is saved.
  // Once per session, for a broker: deals whose Dropbox folder was saved by
  // path only get their permanent folder ID recorded, so renaming those
  // folders won't disconnect them. Only runs once the dropbox_folder_id
  // column exists (it shows up as a key on every row).
  const backfillStarted = useRef(false);
  function maybeBackfillFolderIds(data) {
    if (backfillStarted.current || agent?.role !== "broker" || !data.length) return;
    if (!("dropbox_folder_id" in data[0])) return;
    if (!data.some((t) => t.dropbox_folder_path && !t.dropbox_folder_id)) return;
    backfillStarted.current = true;
    backfillDropboxFolderIds().catch((e) => console.error("Dropbox folder ID backfill failed:", e));
  }

  // Same idea for ZIP codes: once per broker session, look up any missing
  // ones from the address (only once the zip column exists).
  const zipBackfillStarted = useRef(false);
  function maybeBackfillZips(data) {
    if (zipBackfillStarted.current || agent?.role !== "broker" || !data.length) return;
    if (!("zip" in data[0])) return;
    if (!data.some((t) => t.address && !t.zip)) return;
    zipBackfillStarted.current = true;
    fillAllZipCodes()
      .then((r) => r?.filled && loadTransactions({ silent: true }))
      .catch((e) => console.error("ZIP backfill failed:", e));
  }

  async function loadTransactions({ silent = false } = {}) {
    if (!silent) setLoadingTxs(true);
    try {
      const data = await fetchTransactions();
      setTxs(data);
      setSelectedTransaction((current) => (current ? data.find((t) => t.id === current.id) || current : current));
      setError(null);
      maybeBackfillFolderIds(data);
      maybeBackfillZips(data);
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
          const mlsTodo = await seedWonListingTodos(id);
          // Let the coordinator know right away — best-effort.
          notifyTodo({ transactionId: id, event: "listing_won", text: mlsTodo }).catch((e) =>
            console.error("Listing Won notification failed:", e)
          );
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
    if (stage === "market") {
      const tx = txs.find((t) => t.id === id);
      // Moving to On Market IS going live — don't make someone separately remember
      // to check the "Go Live" to-do too. Only acts once (guarded on not already
      // being in rotation) so flipping the stage dropdown back and forth doesn't
      // keep bumping it to the front of the queue.
      if (tx && tx.social_queue_order == null) {
        try {
          const goLiveTodo = tx.todos?.find((t) => t.text === "Go Live");
          if (goLiveTodo && !goLiveTodo.done) {
            await toggleTodo(goLiveTodo.id, true, initialsFor(agent?.name));
          }
          await setSocialRotation(id, true);
        } catch (e) {
          console.error("Failed to auto-join the social rotation on going to market:", e);
          sideEffectError = sideEffectError || `Moved to On Market, but couldn't join the social rotation: ${e.message}`;
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
      const tx = txs.find((t) => t.id === id);
      if (tx?.side === "Buy") {
        await createDropboxFolderForBuyer(id);
      } else {
        await createDropboxFolderForListing(id);
      }
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
    // The transaction coordinator's to-dos always notify the deal's agent;
    // anyone's @mention notifies whoever's named. Best-effort — the to-do is
    // already saved, so a notification failure only gets a toast.
    if (agent?.role === "coordinator" || todoHasMention(text)) {
      try {
        const result = await notifyTodo({ transactionId: id, text, dueDate });
        if (result?.notified?.length) {
          const missing = result.noEmailOnFile?.length ? ` (no email on file for ${result.noEmailOnFile.join(", ")})` : "";
          showToast(`Notified ${result.notified.join(", ")}${missing}${result.testMode ? " — test mode, email went to you" : ""}`);
        }
        if (result?.emailErrors?.length) console.error("notify-todo email errors:", result.emailErrors);
      } catch (e) {
        console.error("notify-todo failed:", e);
        showToast(`To-do saved, but couldn't send the notification: ${e.message}`);
      }
    }
  }

  async function handleToggleTodo(todo, done) {
    // toggleTodo itself was failing silently before this try/catch — any error here
    // aborted the function before loadTransactions ever ran, so the checkbox just
    // looked stuck/unresponsive with nothing visible explaining why. Now the real
    // error (RLS, network, whatever it turns out to be) actually shows up.
    try {
      await toggleTodo(todo.id, done, initialsFor(agent?.name));
    } catch (e) {
      console.error("Failed to update the to-do:", e);
      setError(`Couldn't save that to-do: ${e.message}`);
      return;
    }
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

  async function handleEditTodo(id, patch) {
    await updateTodo(id, patch);
    loadTransactions({ silent: true });
  }

  async function handleDeleteTodo(id) {
    try {
      await deleteTodo(id);
    } catch (e) {
      console.error("Failed to delete the to-do:", e);
      showToast(e.message);
      return;
    }
    loadTransactions({ silent: true });
  }

  async function handleSendTestDigest() {
    setSendingTestDigest(true);
    try {
      const result = await sendTestDailyDigest();
      const n = result?.sent?.length || 0;
      const c = result?.closingReminders?.length || 0;
      showToast(`Sent to your inbox: ${n} to-do digest${n === 1 ? "" : "s"}, ${c} closing reminder${c === 1 ? "" : "s"}`);
      if (result?.errors?.length) console.error("Digest errors:", result.errors);
    } catch (e) {
      showToast(`Couldn't send the test digest: ${e.message}`);
    } finally {
      setSendingTestDigest(false);
    }
  }

  /** Staff bell on a to-do: email + in-app remind the deal's agent about it. */
  async function handleNotifyTodoOwner(todo, remindAgentId) {
    setRemindMenuTodoId(null);
    setNotifyingTodoId(todo.id);
    try {
      const result = await notifyTodo({ transactionId: todo.transaction_id, text: todo.text, dueDate: todo.due_date, notifyOwner: true, remindAgentId });
      if (result?.notified?.length) {
        const missing = result.noEmailOnFile?.length ? ` (no email on file for ${result.noEmailOnFile.join(", ")})` : "";
        showToast(`Reminded ${result.notified.join(", ")}${missing}${result.testMode ? " — test mode, email went to you" : ""}`);
      } else {
        showToast("Nobody to notify on this deal");
      }
    } catch (e) {
      showToast(`Couldn't send the reminder: ${e.message}`);
    } finally {
      setNotifyingTodoId(null);
    }
  }

  // Extra buttons on each to-do row, everywhere to-dos show (see
  // TodoActionsContext). Not rendered for completed to-dos.
  function renderTodoActions(todo) {
    if (todo.done) return null;
    const tx = txs.find((t) => t.id === todo.transaction_id);
    if (!tx) return null;
    const isStaffUser = agent?.role === "broker" || agent?.role === "coordinator";
    const buttons = [];
    if (todo.text === "Send Utilities") {
      buttons.push(
        <button
          key="utility"
          type="button"
          className="todo-action-btn"
          title={tx.seller_emails?.length ? "Open a pre-filled utility email to the client" : "No client email on file — add one on the deal first"}
          onClick={(e) => {
            e.stopPropagation();
            openEmailCompose(buildUtilityEmail(tx));
          }}
        >
          <Mail size={11} /> Utility Email
        </button>
      );
    }
    if (isStaffUser && !viewAsAgent) {
      // Anyone but yourself, the deal's own agent first.
      const people = mentionRoster
        .filter((p) => p.id !== agent.id)
        .sort((a, b) => (a.id === tx.agent_id ? -1 : b.id === tx.agent_id ? 1 : a.name.localeCompare(b.name)));
      const menuOpen = remindMenuTodoId === todo.id;
      buttons.push(
        <span key="notify" className="remind-wrap" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="todo-action-btn"
            disabled={notifyingTodoId === todo.id}
            aria-label="Send someone a reminder about this to-do"
            title="Send someone a reminder about this to-do"
            onClick={() => setRemindMenuTodoId(menuOpen ? null : todo.id)}
          >
            <Bell size={12} />
          </button>
          {menuOpen && (
            <div className="remind-menu" role="menu">
              <div className="remind-menu-title">Remind…</div>
              {people.map((p) => (
                <button title="Send this person a reminder email + in-app notification" key={p.id} type="button" role="menuitem" onClick={() => handleNotifyTodoOwner(todo, p.id)}>
                  {p.name}
                  {p.id === tx.agent_id ? <span className="remind-menu-hint"> · deal agent</span> : null}
                </button>
              ))}
            </div>
          )}
        </span>
      );
    }
    return buttons.length ? buttons : null;
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

  async function handleRelist(id, reason) {
    const newTx = await relistAfterTermination(id, reason);
    await loadTransactions({ silent: true });
    setSelectedTransaction(newTx);
    return newTx;
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
  async function handleReadyForCloseout(tx, ready) {
    try {
      await setReadyForCloseout(tx.id, ready);
    } catch (e) {
      setError(`Couldn't update Ready for Closeout: ${e.message}`);
      return;
    }
    await loadTransactions({ silent: true });
    if (ready) {
      showToast("Marked Ready for Closeout — Fran and Holly have been notified");
      notifyTodo({ transactionId: tx.id, event: "ready_for_closeout" }).catch((e) =>
        console.error("Ready for Closeout notification failed:", e)
      );
    }
  }

  function handleStageChangeRequest(tx, newStage) {
    const isBrokerUser = agent?.role === "broker" && !viewAs;
    if (newStage === "ready_closeout") {
      handleReadyForCloseout(tx, true);
      return;
    }
    if (newStage === "contract" && tx.stage === "contract" && tx.ready_for_closeout_at) {
      handleReadyForCloseout(tx, false);
      return;
    }
    if (newStage === "closed" && !isBrokerUser) return; // only a broker closes a deal
    if (newStage === "contract" && tx.stage !== "contract") {
      handleRequestUnderContract(tx);
    } else if (newStage === "closed" && tx.stage !== "closed") {
      // Same idea as Under Contract opening its form: closing a deal goes
      // straight into the Close-Out Calculator, which marks it Closed on save
      // (and leaves the stage alone if cancelled). Brokers only reach this —
      // everyone else was stopped above.
      // A fresh value each time (not just `true`) so picking Closed again after
      // cancelling out of the calculator still re-triggers DealDetail's effect.
      setSelectedTransaction({ ...tx, _openCloseout: Date.now() });
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
        <button title="Sign out" onClick={signOut}>
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
  // Transaction coordinator: sees every deal (RLS is_staff()) and the
  // Spreadsheet View with all commission figures stripped, but not Manage
  // Agents, the Social Scheduler, or View as Agent.
  const effectiveAgent = viewAs ? { ...agent, role: viewAs } : agent;
  const isCoordinator = effectiveAgent.role === "coordinator";
  const viewerStages = effectiveAgent.role === "broker" ? STAGES : NON_BROKER_STAGES;

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

  if (showTutorial) {
    return (
      <div className="app">
        <TutorialGuide onBack={() => setShowTutorial(false)} />
      </div>
    );
  }

  if (showMySpreadsheet) {
    return (
      <div className="app">
        <AgentSpreadsheetView
          transactions={txs.filter((tx) => tx.agent_id === agent.id)}
          currentAgent={agent}
          onBack={() => setShowMySpreadsheet(false)}
          onOpenDetail={(tx) => {
            setShowMySpreadsheet(false);
            setSelectedTransaction(tx);
          }}
        />
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

  if (showSpreadsheetView) {
    return (
      <div className="app sv-app-wrap">
        <SpreadsheetView
          transactions={txs}
          hideMoney={isCoordinator}
          onBack={() => setShowSpreadsheetView(false)}
          onRefresh={() => loadTransactions({ silent: true })}
          onOpenDetail={(tx) => {
            setShowSpreadsheetView(false);
            setSelectedTransaction(tx);
          }}
        />
      </div>
    );
  }

  if (showActiveListingForm) {
    return (
      <div className="app">
        <ActiveListingForm
          currentAgent={effectiveAgent}
          onCancel={() => setShowActiveListingForm(false)}
          onSubmitted={() => {
            setShowActiveListingForm(false);
            loadTransactions();
          }}
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
          onSubmitted={(tx, { goToGenerate } = {}) => {
            setShowNewCompForm(false);
            loadTransactions();
            if (goToGenerate && tx) {
              setSelectedTransaction({ ...tx, _openGenerateComp: true });
            }
          }}
        />
      </div>
    );
  }

  if (selectedTransaction) {
    return (
      <TodoActionsContext.Provider value={renderTodoActions}>
      <div className="app">
        {error && <div className="error-banner">{error}</div>}
        <DealDetail
          key={selectedTransaction.id}
          className={closingTransaction ? "deal-detail-exit" : "deal-detail-enter"}
          transaction={selectedTransaction}
          stages={viewerStages}
          currentAgent={effectiveAgent}
          onBack={handleCloseDetail}
          onStageChange={handleStageChangeRequest}
          onNotesChange={handleNotesChange}
          onCompsStatusChange={handleCompsStatusChange}
          onAddTodo={handleAddTodo}
          onToggleTodo={handleToggleTodo}
          onEditTodo={handleEditTodo}
          onDeleteTodo={handleDeleteTodo}
          onLockboxChange={handleLockboxChange}
          onRefresh={() => loadTransactions({ silent: true })}
          onRetryDropboxFolder={handleRetryDropboxFolder}
          onTerminate={handleTerminate}
          onReactivate={handleReactivate}
          onRelist={handleRelist}
        />
      </div>
    </TodoActionsContext.Provider>
    );
  }

  // A broker previewing "as agent" should see exactly what that agent would see —
  // just their own deals — same as RLS would actually enforce for a real agent.
  const visibleTxs = viewAsAgent ? txs.filter((tx) => tx.agent_id === agent.id || tx.colist_agent_id === agent.id) : txs;
  const trimmedQuery = searchQuery.trim().toLowerCase();
  const isSearching = trimmedQuery.length > 0;
  const searchResults = isSearching
    ? visibleTxs.filter((tx) =>
        [tx.address, tx.seller_name, tx.buyer_name].some((field) => field?.toLowerCase().includes(trimmedQuery))
      )
    : [];

  // Rendered after the selectedTransaction check on purpose: opening a deal
  // from here and hitting Back lands you back on All Deals, not the tabs.
  if (showAllDeals) {
    return (
      <TodoActionsContext.Provider value={renderTodoActions}>
        <div className="app">
          <header className="app-header">
            <div>
              <div className="brand-eyebrow">Pipeline &amp; Archive</div>
              <h1>All Deals</h1>
            </div>
            <button type="button" className="header-icon-btn" onClick={() => setShowAllDeals(false)} aria-label="Back" title="Back">
              <ArrowLeft size={20} />
            </button>
          </header>
          <div className="deal-page--all all-deals-screen">
            <AllPage
              transactions={visibleTxs}
              stages={viewerStages}
              currentAgent={effectiveAgent}
              onStageChange={handleStageChangeRequest}
              onNotesChange={handleNotesChange}
              onCompsStatusChange={handleCompsStatusChange}
              onAddTodo={handleAddTodo}
              onToggleTodo={handleToggleTodo}
              onEditTodo={handleEditTodo}
              onDeleteTodo={handleDeleteTodo}
              onOpenDetail={setSelectedTransaction}
            />
          </div>
        </div>
      </TodoActionsContext.Provider>
    );
  }

  return (
    <TodoActionsContext.Provider value={renderTodoActions}>
    <div className="app">
      <header className="main-header">
        <div className="main-header-row">
          <div className="brand-logo-group">
            <img src="/hall-collins-logo-full.png" alt="Hall Collins Real Estate Group" className="brand-logo" />
            <span className="app-version" title="App version — goes up by one with every update">v{versionInfo.version}</span>
            <button className="header-icon-btn" onClick={() => setShowTutorial(true)} aria-label="How It Works" title="How It Works">
              <HelpCircle size={18} />
            </button>
          </div>
          <div className="main-header-right">
            <h1>Deal Flow</h1>
            <NotificationBell transactions={txs} onOpenDeal={setSelectedTransaction} />
            <button className="header-icon-btn" onClick={signOut} aria-label="Sign out" title="Sign out">
              <LogOut size={18} />
            </button>
          </div>
        </div>
        {(isRealBroker || effectiveAgent.role === "broker" || isCoordinator) && (
          <div className="app-header-actions">
            {isRealBroker && (
              <button onClick={() => setViewAs((v) => (v === "agent" ? null : "agent"))} title="Broker only — preview the app as a regular agent would see it">
                {viewAs === "agent" ? "View as Broker" : "View as Agent"}
              </button>
            )}
            {isRealBroker && (
              <button onClick={() => setViewAs((v) => (v === "coordinator" ? null : "coordinator"))} title="Broker only — preview the app as the transaction coordinator would see it">
                {viewAs === "coordinator" ? "View as Broker" : "TC View"}
              </button>
            )}
            {/* TEMPORARY — for trying out the daily digest email. Sends every
                agent's digest to Fran only (test mode is forced server-side
                for this path). Remove once the digest is dialed in. */}
            {isRealBroker && !viewAs && (
              <button disabled={sendingTestDigest} onClick={handleSendTestDigest} title="Temporary — email every agent's daily digest to you, in test mode">
                {sendingTestDigest ? "Sending…" : "Test Daily Emails"}
              </button>
            )}
            {effectiveAgent.role === "broker" && (
              <button onClick={() => setShowManageAgents(true)} title="Broker only — add, edit, or deactivate agents">
                Manage Agents
              </button>
            )}
            {/* Both brokers — Holly runs the social rotation. */}
            {effectiveAgent.role === "broker" && (
              <button onClick={() => setShowSocialScheduler(true)} title="Broker only — manage the daily social media rotation">
                Social Scheduler
              </button>
            )}
            {(effectiveAgent.role === "broker" || isCoordinator) && (
              <button onClick={() => setShowSpreadsheetView(true)} title="Every deal, every agent, in one table">
                Spreadsheet View
              </button>
            )}
          </div>
        )}
      </header>

      {viewAsAgent && (
        <div className="view-as-banner">Viewing as an agent would — showing only your own deals.</div>
      )}
      {viewAs === "coordinator" && (
        <div className="view-as-banner">
          TC View — what the transaction coordinator sees. Actions are still real (e.g. the to-do bell really emails the agent).
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      {loadingTxs ? (
        <SkeletonList count={4} />
      ) : (
        <DealPages
          transactions={visibleTxs}
          stages={viewerStages}
          currentAgent={effectiveAgent}
          onStageChange={handleStageChangeRequest}
          onNotesChange={handleNotesChange}
          onCompsStatusChange={handleCompsStatusChange}
          onAddTodo={handleAddTodo}
          onToggleTodo={handleToggleTodo}
          onEditTodo={handleEditTodo}
          onDeleteTodo={handleDeleteTodo}
          onOpenDetail={setSelectedTransaction}
          pageIndex={pageIndex}
          onPageIndexChange={setPageIndex}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          isSearching={isSearching}
          searchResults={searchResults}
          onNewComp={() => setShowNewCompForm(true)}
          onNewUnderContract={
            isCoordinator
              ? undefined
              : () => {
                  setUnderContractPrefill(null);
                  setShowUnderContractForm(true);
                }
          }
          onNewActiveListing={() => setShowActiveListingForm(true)}
          onDeadLead={async (tx, reason) => {
            try {
              await handleTerminate(tx.id, reason?.trim() ? `Dead lead: ${reason.trim()}` : "Dead lead");
              showToast(`🪦 ${tx.address} moved to Dead/Lost`);
            } catch (e) {
              showToast(`Couldn't update: ${e.message}`);
            }
          }}
          onReviveLead={async (tx) => {
            try {
              await handleReactivate(tx.id);
              showToast(tx.stage === "comps" ? `${tx.address} is back in Comps` : `${tx.address} relisted`);
            } catch (e) {
              showToast(`Couldn't update: ${e.message}`);
            }
          }}
        />
      )}

      <div className="cta-button-row">
        <button
          type="button"
          className="my-earnings-cta all-deals-cta"
          title="Every deal in one place — including Closed, Terminated, and prior years"
          onClick={() => setShowAllDeals(true)}
        >
          All Deals
        </button>
        {!isCoordinator && (
          <button title="Your own deals and commission totals in one table" type="button" className="my-earnings-cta my-spreadsheet-cta" onClick={() => setShowMySpreadsheet(true)}>
            My Spreadsheet
          </button>
        )}
      </div>
    </div>
    </TodoActionsContext.Provider>
  );
}
