// Does one of us need to be at showings? Stored on transactions.showing_access.
//   "Solo"        — buyer's agents can show it on their own (lockbox, etc.)
//   "Accompanied" — one of us has to attend every showing
export const SHOWING_ACCESS_OPTIONS = [
  { value: "Solo", label: "Solo OK — buyer's agents can show on their own" },
  { value: "Accompanied", label: "Agent Present — we attend every showing" },
];

export const SHOWING_ACCESS_TAGS = {
  Solo: { label: "Solo OK", title: "Buyer's agents can show this one on their own", className: "tx-icon-badge--solo" },
  Accompanied: { label: "Agent Present", title: "One of us needs to be at every showing", className: "tx-icon-badge--accompanied" },
};
