export default function LoginScreen({ onSignIn }) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <img src="/hall-collins-logo-full.png" alt="Hall Collins Real Estate Group" className="login-logo" />
        <h1>Transaction Dashboard</h1>
        <button className="google-btn" onClick={onSignIn}>
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
