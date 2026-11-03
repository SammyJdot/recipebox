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
          RecipeBox
        </Link>
        {user ? (
          <div className="account">
            <span>{user.display_name}</span>
            <button className="quiet" onClick={logout}>
              Log out
            </button>
          </div>
        ) : null}
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
      {config.auth_mode === "oidc" ? (
        <div className="oidc-sign-in">
          <ErrorMessage error={error} />
          <a className="button primary" href="/auth/oidc">
            Sign in
          </a>
        </div>
      ) : (
        <section className="panel login-panel">
          <h1>{register ? "Create account" : "Sign in"}</h1>
          <ErrorMessage error={error} />
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
              {register ? "Log in" : "Create account"}
            </button>
          ) : null}
        </section>
      )}
    </div>
  );
}
