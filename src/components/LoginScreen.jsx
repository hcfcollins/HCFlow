export default function LoginScreen({ onSignIn }) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="brand-eyebrow">Hall Collins Real Estate Group</div>
        <h1>Transaction Dashboard</h1>
        <button className="google-btn" onClick={onSignIn}>
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
