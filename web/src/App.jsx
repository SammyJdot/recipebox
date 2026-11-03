import { createContext, useContext, useEffect, useState } from "react";
import { Link, Route, Routes, useNavigate } from "react-router-dom";
import { api, authConfig } from "./api.js";
import { Dashboard } from "./Dashboard.jsx";
import { RecipeEditor, RecipeView } from "./Recipe.jsx";
const Session = createContext(null);
export const useSession = () => useContext(Session);
export function ErrorMessage({ error }) {
  return error ? (
    <div className="error" role="alert">
      {error}
    </div>
  ) : null;
}
export function Loading() {
  return (
    <p className="loading" role="status">
      Loading…
    </p>
  );
}
export function App() {
  const [config, setConfig] = useState(null);
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const configuration = await authConfig();
        const response = await fetch("/api/me");
        if (!response.ok && response.status !== 401)
          throw new Error("Unable to load your session");
        const current = response.ok ? await response.json() : null;
        if (active) {
          setConfig(configuration);
          setUser(current);
        }
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        if (active) setReady(true);
      }
    })();
    const expired = () => {
      setUser(null);
      authConfig()
        .then(setConfig)
        .catch((e) => setError(e.message));
    };
    window.addEventListener("session-expired", expired);
    return () => {
      active = false;
      window.removeEventListener("session-expired", expired);
    };
  }, []);
  const login = (current) => {
    setUser(current);
    navigate("/");
  };
  const logout = async () => {
    try {
      await api("/auth/logout", { method: "POST" });
      setUser(null);
      setConfig(await authConfig());
      navigate("/");
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <Session.Provider value={{ user }}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <Link className="brand" to="/">
          <img src="/icon.svg" alt="" width="38" height="38" />
          RecipeBox
        </Link>
        {user ? (
          <div className="account">
            <span>{user.display_name}</span>
            <button className="quiet" onClick={logout}>
              Log out
            </button>
          </div>
        ) : (
          <span className="tagline">A place for every recipe.</span>
        )}
      </header>
      <main id="main" tabIndex="-1">
        <ErrorMessage error={error} />
        {!ready ? (
          <Loading />
        ) : !config ? (
          <p>Unable to connect. Reload to try again.</p>
        ) : !user ? (
          <Login config={config} onLogin={login} />
        ) : (
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/recipes/new" element={<RecipeEditor />} />
            <Route path="/recipes/:id" element={<RecipeView />} />
            <Route path="/recipes/:id/edit" element={<RecipeEditor />} />
            <Route
              path="*"
              element={
                <p>
                  Page not found. <Link to="/">Return to recipes</Link>
                </p>
              }
            />
          </Routes>
        )}
      </main>
      <footer className="site-footer">
        RecipeBox · A little more organized. A little more time to cook.
      </footer>
    </Session.Provider>
  );
}
function Login({ config, onLogin }) {
  const [register, setRegister] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    const fields = new FormData(event.currentTarget);
    try {
      const result = await api(register ? "/auth/register" : "/auth/login", {
        method: "POST",
        body: Object.fromEntries(fields),
      });
      onLogin(result.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-layout">
      <div className="login-intro">
        <span className="eyebrow">KEEP THE GOOD RECIPES</span>
        <h1>
          Your next favorite
          <br />
          meal starts here.
        </h1>
        <p>Collect recipes, tuck them into boxes, and make them your own.</p>
        <div className="paper-card" aria-hidden="true">
          <span className="eyebrow">THE RECIPE FOR A GOOD DAY</span>
          <div className="paper-title">Something worth making.</div>
          <div className="paper-rule" />
          <p>
            A few ingredients.
            <br />A little inspiration.
            <br />A place to keep it all.
          </p>
        </div>
      </div>
      <section className="panel login-panel">
        <span className="eyebrow">WELCOME TO RECIPEBOX</span>
        <h2>{register ? "Create your account" : "Make yourself at home."}</h2>
        <ErrorMessage error={error} />
        {config.auth_mode === "oidc" ? (
          <>
            <p>Sign in to open your recipe collection.</p>
            <a className="button" href="/auth/oidc">
              Sign in
            </a>
          </>
        ) : (
          <>
            <form onSubmit={submit}>
              {register ? (
                <label>
                  Display name
                  <input
                    name="display_name"
                    autoComplete="name"
                    maxLength={120}
                    required
                  />
                </label>
              ) : null}
              <label>
                Username
                <input
                  name="username"
                  autoComplete="username"
                  minLength={3}
                  maxLength={64}
                  pattern="[a-zA-Z0-9_.\-]+"
                  required
                />
              </label>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete={register ? "new-password" : "current-password"}
                  minLength={12}
                  maxLength={72}
                  required
                />
              </label>
              <p className="hint">
                At least 12 characters. Up to 72 UTF-8 bytes.
              </p>
              {register ? (
                <label>
                  Email <span className="muted">(optional)</span>
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    maxLength={254}
                  />
                </label>
              ) : null}
              <button disabled={busy} className="primary">
                {busy ? "Please wait…" : register ? "Create account" : "Log in"}
              </button>
            </form>
            {config.allow_registration ? (
              <button
                className="text-button"
                onClick={() => {
                  setRegister(!register);
                  setError("");
                }}
              >
                {register
                  ? "Already have an account? Log in"
                  : "New here? Create an account"}
              </button>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
