/** A little RIP headstone — for "Dead/Lost" comps. */
export default function Tombstone({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 21V10a6 6 0 0 1 12 0v11z" fill="currentColor" opacity="0.18" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M3.5 21h17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <text x="12" y="15.2" textAnchor="middle" fontSize="5.4" fontWeight="800" fontFamily="Montserrat, Arial, sans-serif" fill="currentColor">
        RIP
      </text>
    </svg>
  );
}
