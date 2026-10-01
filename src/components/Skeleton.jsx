/** Mimics the shape of a .tx-card while real data loads, instead of plain
 * "Loading…" text sitting in an otherwise-empty screen. */
export function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="skeleton-line skeleton-line--title" />
      <div className="skeleton-line skeleton-line--sub" />
      <div className="skeleton-line skeleton-line--body" />
    </div>
  );
}

export function SkeletonList({ count = 4 }) {
  return (
    <div className="skeleton-list">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
