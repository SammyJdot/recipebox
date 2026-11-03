import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "./api.js";
import { ErrorMessage, Loading, useSession } from "./App.jsx";
export function Dashboard() {
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const boxId = params.get("box_id") || "";
  const tag = params.get("tag") || "";
  const [search, setSearch] = useState(q);
  const [boxes, setBoxes] = useState([]);
  const [recipes, setRecipes] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setRecipes(null);
    Promise.all([
      api(
        `/api/recipes?${new URLSearchParams({ q, box_id: boxId, ...(tag ? { tag } : {}) })}`,
        {
          signal: controller.signal,
        },
      ),
      api("/api/boxes", { signal: controller.signal }),
    ])
      .then(([r, b]) => {
        setRecipes(r);
        setBoxes(b);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [q, boxId, tag, revision]);
  useEffect(() => {
    setSearch(q);
  }, [q]);
  const selected = boxes.find((b) => String(b.id) === boxId);
  const filter = (id) =>
    setParams({
      ...(q ? { q } : {}),
      ...(id ? { box_id: id } : {}),
      ...(tag ? { tag } : {}),
    });
  const saveBox = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(editing.id ? `/api/boxes/${editing.id}` : "/api/boxes", {
        method: editing.id ? "PUT" : "POST",
        body: { name: editing.name, description: editing.description },
      });
      setEditing(null);
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const deleteBox = async () => {
    if (
      !window.confirm(
        "Delete this box? Its recipes will stay in your collection.",
      )
    )
      return;
    try {
      await api(`/api/boxes/${selected.id}`, { method: "DELETE" });
      filter("");
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Recipes</h1>
        </div>
        <Link className="button primary" to="/recipes/new">
          + New recipe
        </Link>
      </div>
      <form
        className="search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setParams({
            ...(search ? { q: search } : {}),
            ...(boxId ? { box_id: boxId } : {}),
            ...(tag ? { tag } : {}),
          });
        }}
      >
        <label className="sr-only" htmlFor="recipe-search">
          Search by title, ingredient, or tag
        </label>
        <span aria-hidden="true">⌕</span>
        <input
          id="recipe-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          maxLength={200}
          placeholder="Search by title, ingredient, or tag…"
        />
        <button type="submit">Search</button>
      </form>
      <ErrorMessage error={error} />
      {tag ? (
        <div className="active-tag">
          <span>Tag: {tag}</span>
          <button
            onClick={() =>
              setParams({
                ...(q ? { q } : {}),
                ...(boxId ? { box_id: boxId } : {}),
              })
            }
          >
            Clear tag filter
          </button>
        </div>
      ) : null}
      <div className="collection-layout">
        <aside className="box-sidebar">
          <div className="section-heading">
            <h2>Boxes</h2>
            <button
              className="quiet"
              aria-label="Create a box"
              onClick={() => setEditing({ name: "", description: "" })}
            >
              +
            </button>
          </div>
          <p className="hint">Visible to all users.</p>
          <nav aria-label="Recipe boxes">
            <button
              className={`box-link ${!boxId ? "selected" : ""}`}
              onClick={() => filter("")}
            >
              ▦ <span>All recipes</span>
            </button>
            {boxes.map((b) => (
              <button
                className={`box-link ${String(b.id) === boxId ? "selected" : ""}`}
                key={b.id}
                onClick={() => filter(String(b.id))}
              >
                ▱ <span>{b.name}</span>
                <small>{b.recipe_count}</small>
              </button>
            ))}
          </nav>
          {!boxes.length ? <p className="hint">No boxes yet</p> : null}
          <button
            className="text-button"
            onClick={() => setEditing({ name: "", description: "" })}
          >
            + Create a box
          </button>
        </aside>
        <section className="recipe-collection" aria-label="Recipes">
          <div className="section-heading">
            <div>
              <h2>
                {selected
                  ? selected.name
                  : q || tag
                    ? "Search results"
                    : "Recent recipes"}
              </h2>
              {selected?.description ? <p>{selected.description}</p> : null}
            </div>
            {selected?.creator_id === user.id ? (
              <div className="actions">
                <button className="quiet" onClick={() => setEditing(selected)}>
                  Edit box
                </button>
                <button className="quiet danger" onClick={deleteBox}>
                  Delete box
                </button>
              </div>
            ) : null}
          </div>
          {recipes === null ? (
            error ? null : (
              <Loading />
            )
          ) : recipes.length ? (
            <>
              <p className="hint">
                {recipes.length} {recipes.length === 1 ? "recipe" : "recipes"}
                {recipes.length === 500
                  ? " · Refine your search to see more"
                  : ""}
              </p>
              <div className="recipe-grid">
                {recipes.map((r) => (
                  <Link
                    className="recipe-card"
                    key={r.id}
                    to={`/recipes/${r.id}`}
                  >
                    {r.thumbnail_url ? (
                      <img src={r.thumbnail_url} alt="" loading="lazy" />
                    ) : (
                      <div className="recipe-placeholder" aria-hidden="true">
                        <span>☷</span>
                      </div>
                    )}
                    <div className="recipe-card-content">
                      <h3>{r.title}</h3>
                      {r.description ? <p>{r.description}</p> : null}
                      {r.tags.length ? (
                        <div className="tags">
                          {r.tags.slice(0, 3).map((tag) => (
                            <span className="tag" key={tag}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <div className="recipe-meta">
                        <span>
                          {r.prep_minutes != null || r.cook_minutes != null
                            ? `${(r.prep_minutes || 0) + (r.cook_minutes || 0)} min`
                            : "Time not set"}
                        </span>
                        {r.servings !== null ? (
                          <span>{r.servings} servings</span>
                        ) : null}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <h3>
                {q || tag
                  ? "No recipes found"
                  : selected
                    ? "No recipes in this box"
                    : "No recipes yet"}
              </h3>
              <div className="actions">
                <Link className="button primary" to="/recipes/new">
                  Create a recipe
                </Link>
                {!selected && !q && !tag ? (
                  <button
                    onClick={() => setEditing({ name: "", description: "" })}
                  >
                    Create a box
                  </button>
                ) : null}
                {boxId ? (
                  <button onClick={() => filter("")}>Browse all recipes</button>
                ) : null}
              </div>
            </div>
          )}
        </section>
      </div>
      {editing ? (
        <BoxDialog onClose={() => setEditing(null)}>
          <h2 id="box-title">{editing.id ? "Edit box" : "Create a box"}</h2>
          <p>Every logged-in user can see this box and organize its recipes.</p>
          <form onSubmit={saveBox}>
            <label>
              Name
              <input
                autoFocus
                required
                maxLength={120}
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
            </label>
            <label>
              Description
              <textarea
                maxLength={2000}
                value={editing.description}
                onChange={(e) =>
                  setEditing({ ...editing, description: e.target.value })
                }
              />
            </label>
            <ErrorMessage error={error} />
            <div className="actions">
              <button className="primary" disabled={busy}>
                {busy ? "Saving…" : "Save box"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        </BoxDialog>
      ) : null}
    </>
  );
}

function BoxDialog({ onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="panel modal"
      aria-labelledby="box-title"
      onCancel={onClose}
    >
      {children}
    </dialog>
  );
}
