import { useState } from "react";
import {
  ClipboardList,
  FileText,
  Trophy,
  Megaphone,
  Home,
  FileSignature,
  PartyPopper,
} from "lucide-react";

// Mirrors the actual stage flow enforced in the schema/App.jsx — keep in sync if
// that changes: transactions.stage = comps -> won -> market -> contract -> closed
// for a listing (side=Sell); a buyer-side deal (side=Buy) skips straight to
// contract -> closed since there's no listing to market.
const SELLER_STEPS = [
  {
    icon: ClipboardList,
    title: "New Comp",
    body: "Start here for a listing appointment. Capture the seller's info, property details, lead source, and any seller recommendations. This creates the deal in the Comps stage.",
  },
  {
    icon: FileText,
    title: "Generate Comp PDF",
    body: "From the deal, click Generate Comp to build a branded CMA — price range, land or multi-family analysis if relevant, your agent notes, plus your EasyCMA export and the Vermont ANR map, all merged behind the Hall Collins cover page and filed straight to Dropbox.",
  },
  {
    icon: Trophy,
    title: "Move to Won Listing",
    body: "Once they sign, change the stage to Won Listing. This automatically builds the full Dropbox folder structure for the listing and seeds the Won Listing to-do checklist.",
  },
  {
    icon: Megaphone,
    title: "Go Live",
    body: "Check off the Go Live to-do (or just switch the stage to On Market, which checks it for you). This pushes the listing straight to the top of the Social Media Scheduler's daily rotation.",
  },
  {
    icon: Home,
    title: "Active Listing",
    body: "While On Market, adjust the sign and lockbox info right from the deal, and use the social post menu (New Listing Post, Boost, Open House) to keep marketing it — the Social Scheduler keeps rotating it through daily posts until it's under contract.",
  },
  {
    icon: FileSignature,
    title: "Under Contract",
    body: "Once there's an accepted offer, move to Under Contract — closing date, attorneys, deposits, inspection/financing dates, and commission details go here. This automatically pulls the listing out of the daily social rotation.",
  },
  {
    icon: PartyPopper,
    title: "Closed",
    body: "At the closing table, use the Close-Out Calculator to lock in the final commission split and bank amount. The listing becomes eligible for its one closing shoutout post.",
  },
];

const BUYER_STEPS = [
  {
    icon: FileSignature,
    title: "Under Contract",
    body: "There's no comp step on the buyer side — once your buyer has an accepted offer, start directly on Under Contract: buyer info, price, attorneys, closing date, lead source, deposits, and commission details.",
  },
  {
    icon: PartyPopper,
    title: "Closed",
    body: "At closing, use the Close-Out Calculator the same way as on a listing to lock in the final commission split and bank amount.",
  },
];

function StepList({ steps }) {
  return (
    <ol className="tutorial-steps">
      {steps.map(({ icon: Icon, title, body }, i) => (
        <li key={title} className="tutorial-step">
          <div className="tutorial-step-marker">
            <Icon size={18} />
          </div>
          <div className="tutorial-step-body">
            <div className="tutorial-step-num">Step {i + 1}</div>
            <h3>{title}</h3>
            <p>{body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function TutorialGuide({ onBack }) {
  const [tab, setTab] = useState("seller");

  return (
    <div className="tutorial-guide">
      <header className="app-header">
        <div>
          <div className="brand-eyebrow">Help</div>
          <h1>How It Works</h1>
        </div>
        <button type="button" onClick={onBack}>
          Close
        </button>
      </header>

      <div className="tutorial-tabs">
        <button type="button" className={tab === "seller" ? "tutorial-tab tutorial-tab--active" : "tutorial-tab"} onClick={() => setTab("seller")}>
          For Sellers (Listings)
        </button>
        <button type="button" className={tab === "buyer" ? "tutorial-tab tutorial-tab--active" : "tutorial-tab"} onClick={() => setTab("buyer")}>
          For Buyers
        </button>
      </div>

      <StepList steps={tab === "seller" ? SELLER_STEPS : BUYER_STEPS} />
    </div>
  );
}
