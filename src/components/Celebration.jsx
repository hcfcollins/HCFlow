import { useEffect, useMemo } from "react";

const COLORS = ["#C7155B", "#173348", "#F2B2C1", "#D7E2EF", "#A4B792", "#D7D1C2"];

export default function Celebration({ onDone }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 2500);
    return () => clearTimeout(timer);
  }, [onDone]);

  const pieces = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.4,
        duration: 1.8 + Math.random() * 1.2,
        color: COLORS[i % COLORS.length],
        rotate: Math.random() * 360,
      })),
    []
  );

  return (
    <div className="celebration" onClick={onDone}>
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            transform: `rotate(${p.rotate}deg)`,
          }}
        />
      ))}
      <div className="celebration-message">
        <div className="celebration-unicorn">🦄</div>
        <div className="celebration-text">Congratulations!</div>
      </div>
    </div>
  );
}
