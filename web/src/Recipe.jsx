import { useEffect, useState, useId } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "./api.js";
import { ErrorMessage, Loading, useSession } from "./App.jsx";
import { scaleQuantity } from "./quantities.js";
const emptyIngredient = () => ({ quantity: "", unit: "", item: "", note: "" });
const emptyRecipe = () => ({
  title: "",
  description: "",
  servings: "",
  tags: "",
  prep_minutes: "",
  cook_minutes: "",
  source: "",
  ingredients: [emptyIngredient()],
  steps: [{ text: "" }],
});
export function RecipeEditor() {
  const { id } = useParams();
  const { user } = useSession();
  const navigate = useNavigate();
  const [recipe, setRecipe] = useState(id ? null : emptyRecipe);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  useEffect(() => {
    if (!id) {
      setRecipe(emptyRecipe());
      return;
    }
    const controller = new AbortController();
    setRecipe(null);
    api(`/api/recipes/${id}`, { signal: controller.signal })
      .then((r) => {
        if (r.author_id !== user.id) {
          setForbidden(true);
          return;
        }
        setRecipe({
          ...r,
          servings: r.servings ?? "",
          tags: r.tags.join(", "),
          prep_minutes: r.prep_minutes ?? "",
          cook_minutes: r.cook_minutes ?? "",
          ingredients: r.ingredients.map((i) => ({
            ...i,
            quantity: i.quantity ?? "",
          })),
        });
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [id, user.id]);
  const field = (key, value) => setRecipe((r) => ({ ...r, [key]: value }));
  const updateRow = (key, index, value) =>
    setRecipe((r) => ({
      ...r,
      [key]: r[key].map((row, i) => (i === index ? { ...row, ...value } : row)),
    }));
  const removeRow = (key, index) =>
    field(
      key,
      recipe[key].filter((_, i) => i !== index),
    );
  const reorder = (key, index, direction) => {
    const next = [...recipe[key]];
    [next[index], next[index + direction]] = [
      next[index + direction],
      next[index],
    ];
    field(key, next);
  };
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const body = {
      title: recipe.title,
      description: recipe.description,
      servings: recipe.servings === "" ? null : Number(recipe.servings),
      tags: recipe.tags.split(","),
      prep_minutes:
        recipe.prep_minutes === "" ? null : Number(recipe.prep_minutes),
      cook_minutes:
        recipe.cook_minutes === "" ? null : Number(recipe.cook_minutes),
      source: recipe.source,
      ingredients: recipe.ingredients.map((i) => ({
        ...i,
        quantity: i.quantity || null,
      })),
      steps: recipe.steps,
    };
    try {
      const saved = await api(id ? `/api/recipes/${id}` : "/api/recipes", {
        method: id ? "PUT" : "POST",
        body,
      });
      navigate(`/recipes/${saved.id}${id ? "" : "?saved=1"}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (forbidden)
    return (
      <p>
        Only the author can edit this recipe.{" "}
        <Link to={`/recipes/${id}`}>View recipe</Link>
      </p>
    );
  if (!recipe) return error ? <ErrorMessage error={error} /> : <Loading />;
  return (
    <div className="editor">
      <Link className="back-link" to={id ? `/recipes/${id}` : "/"}>
        ← {id ? "Back to recipe" : "Back to collection"}
      </Link>
      <div className="page-heading">
        <div>
          <h1>{id ? "Edit recipe" : "New recipe"}</h1>
          <p>Add photos after saving.</p>
        </div>
      </div>
      <form onSubmit={save}>
        <fieldset disabled={busy} className="editor-fieldset">
          <section className="panel">
            <h2>Details</h2>
            <label>
              Recipe title
              <input
                required
                autoFocus
                maxLength={200}
                value={recipe.title}
                onChange={(e) => field("title", e.target.value)}
                placeholder="Recipe title"
              />
            </label>
            <label>
              Description
              <textarea
                maxLength={10000}
                value={recipe.description}
                onChange={(e) => field("description", e.target.value)}
                placeholder="Description"
              />
            </label>
            <label>
              Tags (optional, comma-separated)
              <input
                value={recipe.tags}
                onChange={(e) => field("tags", e.target.value)}
              />
            </label>
            <p className="hint">Up to 10 tags, 30 characters each.</p>
            <div className="three-columns">
              <label>
                Servings
                <input
                  type="number"
                  min="1"
                  max="10000"
                  step="1"
                  value={recipe.servings}
                  onChange={(e) => field("servings", e.target.value)}
                />
              </label>
              <label>
                Prep time <span className="muted">(min)</span>
                <input
                  type="number"
                  min="0"
                  max="100000"
                  value={recipe.prep_minutes}
                  onChange={(e) => field("prep_minutes", e.target.value)}
                />
              </label>
              <label>
                Cook time <span className="muted">(min)</span>
                <input
                  type="number"
                  min="0"
                  max="100000"
                  value={recipe.cook_minutes}
                  onChange={(e) => field("cook_minutes", e.target.value)}
                />
              </label>
            </div>
          </section>
          <section className="panel">
            <h2>Ingredients</h2>
            <p className="hint">
              Quantities can be decimals or fractions, like 1/2 or 1 1/2.
            </p>
            <div className="ordered-rows">
              {recipe.ingredients.map((ingredient, index) => (
                <div className="ingredient-editor" key={index}>
                  <span className="row-number">{index + 1}</span>
                  <div className="ingredient-fields">
                    <div className="quantity-fields">
                      <label>
                        Quantity
                        <input
                          aria-label={`Ingredient ${index + 1} quantity`}
                          maxLength={80}
                          value={ingredient.quantity}
                          onChange={(e) =>
                            updateRow("ingredients", index, {
                              quantity: e.target.value,
                            })
                          }
                          placeholder="1/2"
                        />
                      </label>
                      <label>
                        Unit
                        <input
                          aria-label={`Ingredient ${index + 1} unit`}
                          maxLength={80}
                          value={ingredient.unit}
                          onChange={(e) =>
                            updateRow("ingredients", index, {
                              unit: e.target.value,
                            })
                          }
                          placeholder="cup"
                        />
                      </label>
                    </div>
                    <label className="item-field">
                      Ingredient
                      <input
                        required
                        aria-label={`Ingredient ${index + 1} item`}
                        maxLength={300}
                        value={ingredient.item}
                        onChange={(e) =>
                          updateRow("ingredients", index, {
                            item: e.target.value,
                          })
                        }
                        placeholder="Ingredient name"
                      />
                    </label>
                    <label className="note-field">
                      Note <span className="muted">(optional)</span>
                      <input
                        aria-label={`Ingredient ${index + 1} note`}
                        maxLength={500}
                        value={ingredient.note}
                        onChange={(e) =>
                          updateRow("ingredients", index, {
                            note: e.target.value,
                          })
                        }
                        placeholder="finely chopped"
                      />
                    </label>
                  </div>
                  <RowActions
                    label={`ingredient ${index + 1}`}
                    index={index}
                    length={recipe.ingredients.length}
                    onMove={(d) => reorder("ingredients", index, d)}
                    onRemove={() => removeRow("ingredients", index)}
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                field("ingredients", [...recipe.ingredients, emptyIngredient()])
              }
              disabled={recipe.ingredients.length >= 200}
            >
              + Add ingredient
            </button>
          </section>
          <section className="panel">
            <h2>Method</h2>
            <div className="ordered-rows">
              {recipe.steps.map((step, index) => (
                <div className="step-editor" key={index}>
                  <span className="row-number">{index + 1}</span>
                  <label className="step-text">
                    Step {index + 1}
                    <textarea
                      required
                      maxLength={5000}
                      value={step.text}
                      onChange={(e) =>
                        updateRow("steps", index, { text: e.target.value })
                      }
                      placeholder="Step instructions"
                    />
                  </label>
                  <RowActions
                    label={`step ${index + 1}`}
                    index={index}
                    length={recipe.steps.length}
                    onMove={(d) => reorder("steps", index, d)}
                    onRemove={() => removeRow("steps", index)}
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => field("steps", [...recipe.steps, { text: "" }])}
              disabled={recipe.steps.length >= 100}
            >
              + Add step
            </button>
          </section>
          <section className="panel">
            <label>
              Source <span className="muted">(optional)</span>
              <textarea
                maxLength={2000}
                value={recipe.source}
                onChange={(e) => field("source", e.target.value)}
                placeholder="Book, URL, or other source"
              />
            </label>
          </section>
          <ErrorMessage error={error} />
          <div className="editor-footer actions">
            <button className="primary">
              {busy ? "Saving…" : "Save recipe"}
            </button>
            <Link className="button" to={id ? `/recipes/${id}` : "/"}>
              Cancel
            </Link>
          </div>
        </fieldset>
      </form>
    </div>
  );
}
function RowActions({ label, index, length, onMove, onRemove }) {
  return (
    <div className="row-actions">
      <button
        type="button"
        className="quiet"
        disabled={!index}
        aria-label={`Move ${label} up`}
        onClick={() => onMove(-1)}
      >
        ↑
      </button>
      <button
        type="button"
        className="quiet"
        disabled={index === length - 1}
        aria-label={`Move ${label} down`}
        onClick={() => onMove(1)}
      >
        ↓
      </button>
      <button
        type="button"
        className="quiet danger"
        disabled={length === 1}
        aria-label={`Remove ${label}`}
        onClick={onRemove}
      >
        ×
      </button>
    </div>
  );
}
export function RecipeView() {
  const { id } = useParams();
  const { user } = useSession();
  const navigate = useNavigate();
  const [recipe, setRecipe] = useState(null);
  const [boxes, setBoxes] = useState([]);
  const [servings, setServings] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    Promise.all([
      api(`/api/recipes/${id}`, { signal: controller.signal }),
      api("/api/boxes", { signal: controller.signal }),
    ])
      .then(([r, b]) => {
        setRecipe(r);
        setBoxes(b);
        setServings(
          (current) =>
            current ||
            (r.servings === null
              ? ""
              : String(Math.max(1, Math.ceil(r.servings)))),
        );
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [id, revision]);
  useEffect(() => {
    setRecipe(null);
    setServings("");
  }, [id]);
  const change = async (path, method, body) => {
    setBusy(true);
    setError("");
    try {
      await api(path, { method, body });
      setRevision((v) => v + 1);
      return true;
    } catch (e) {
      setError(e.message);
      setRevision((v) => v + 1);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const upload = async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError("Photo exceeds the 10 MB limit");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Use a JPEG, PNG, or WebP photo");
      return;
    }
    const form = new FormData();
    form.append("photo", file);
    await change(`/api/recipes/${id}/photos`, "POST", form);
  };
  const remove = async () => {
    if (
      !window.confirm(
        "Delete this recipe, photos, and comments? This cannot be undone.",
      )
    )
      return;
    setBusy(true);
    try {
      await api(`/api/recipes/${id}`, { method: "DELETE" });
      navigate("/");
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  if (!recipe) return error ? <ErrorMessage error={error} /> : <Loading />;
  const mine = recipe.author_id === user.id;
  const cover = recipe.photos.find((p) => p.is_cover);
  const hasServings = recipe.servings !== null;
  const validServings =
    Number.isInteger(Number(servings)) &&
    Number(servings) >= 1 &&
    Number(servings) <= 10000;
  const factor =
    hasServings && validServings ? Number(servings) / recipe.servings : 1;
  return (
    <article className="recipe-detail">
      <div className="detail-toolbar no-print">
        <Link className="back-link" to="/">
          ← All recipes
        </Link>
        <div className="actions">
          <button onClick={() => window.print()}>Print recipe</button>
          {mine ? (
            <Link className="button primary" to={`/recipes/${id}/edit`}>
              Edit recipe
            </Link>
          ) : null}
        </div>
      </div>
      <ErrorMessage error={error} />
      <div className={`recipe-hero ${cover ? "with-photo" : ""}`}>
        <div>
          <h1>{recipe.title}</h1>
          {recipe.description ? (
            <p className="recipe-description">{recipe.description}</p>
          ) : null}
          {recipe.tags.length ? (
            <nav className="tags" aria-label="Recipe tags">
              {recipe.tags.map((tag) => (
                <Link
                  className="tag"
                  key={tag}
                  to={`/?${new URLSearchParams({ tag })}`}
                >
                  {tag}
                </Link>
              ))}
            </nav>
          ) : null}
          <p className="author">Added by {recipe.author_name}</p>
          <dl className="timing">
            {hasServings ? (
              <div>
                <dt>Serves</dt>
                <dd>{validServings ? servings : recipe.servings}</dd>
              </div>
            ) : null}
            {recipe.prep_minutes !== null ? (
              <div>
                <dt>Prep</dt>
                <dd>{recipe.prep_minutes} min</dd>
              </div>
            ) : null}
            {recipe.cook_minutes !== null ? (
              <div>
                <dt>Cook</dt>
                <dd>{recipe.cook_minutes} min</dd>
              </div>
            ) : null}
          </dl>
        </div>
        {cover ? (
          <img className="cover-photo" src={cover.url} alt={recipe.title} />
        ) : null}
      </div>
      <div className="cooking-layout">
        <section className="ingredients-panel">
          <div className="section-heading">
            <h2>Ingredients</h2>
          </div>
          {hasServings ? (
            <div className="scaling no-print">
              <label htmlFor="servings">Servings</label>
              <input
                id="servings"
                type="number"
                min="1"
                max="10000"
                step="1"
                value={servings}
                aria-invalid={!validServings}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === "") setServings("");
                  else if (
                    Number.isInteger(Number(value)) &&
                    Number(value) >= 1 &&
                    Number(value) <= 10000
                  )
                    setServings(String(Number(value)));
                }}
              />
              <button
                className="quiet"
                onClick={() =>
                  setServings(String(Math.max(1, Math.ceil(recipe.servings))))
                }
              >
                Reset
              </button>
            </div>
          ) : null}
          {hasServings && !validServings ? (
            <p className="hint no-print">
              Enter whole-number servings from 1 to 10,000.
            </p>
          ) : null}
          {factor !== 1 ? (
            <p className="hint">
              Scaled from {recipe.servings} servings. Times stay the same.
            </p>
          ) : null}
          <ul className="ingredient-list">
            {recipe.ingredients.map((ingredient, index) => (
              <li key={index}>
                <span className="ingredient-quantity">
                  {hasServings
                    ? scaleQuantity(ingredient.quantity, factor)
                    : ingredient.quantity || ""}{" "}
                  {ingredient.unit}
                </span>
                <span>
                  {ingredient.item}
                  {ingredient.note ? <small>{ingredient.note}</small> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="method-panel">
          <h2>Method</h2>
          <ol className="method-list">
            {recipe.steps.map((step, index) => (
              <li key={index}>
                <span className="step-marker" aria-hidden="true">
                  {index + 1}
                </span>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
      {recipe.source ? (
        <section className="source">
          <h2>Source</h2>
          <p>{recipe.source}</p>
        </section>
      ) : null}
      <section className="panel no-print">
        <h2>Boxes</h2>
        <p className="hint">
          All users can add or remove this recipe from boxes.
        </p>
        {boxes.length ? (
          <fieldset disabled={busy} className="box-checks">
            {boxes.map((box) => {
              const checked = recipe.boxes.some((b) => b.id === box.id);
              return (
                <label key={box.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      setRecipe((current) => ({
                        ...current,
                        boxes: checked
                          ? current.boxes.filter((b) => b.id !== box.id)
                          : [...current.boxes, box],
                      }));
                      change(
                        checked
                          ? `/api/boxes/${box.id}/recipes/${id}`
                          : `/api/boxes/${box.id}/recipes`,
                        checked ? "DELETE" : "POST",
                        checked ? undefined : { recipe_id: recipe.id },
                      );
                    }}
                  />
                  {box.name}
                </label>
              );
            })}
          </fieldset>
        ) : (
          <p>
            No boxes yet. <Link to="/">Manage boxes</Link>
          </p>
        )}
      </section>
      <section className="photos-section no-print">
        <div className="section-heading">
          <div>
            <h2>Photos</h2>
            <p className="hint">
              JPEG, PNG, or WebP · 10 MB per photo · Up to 30 photos
            </p>
          </div>
          <label className={`button upload-button ${busy ? "disabled" : ""}`}>
            + Add photo
            <input
              aria-label="Upload photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={upload}
            />
          </label>
        </div>
        {mine && recipe.manual_cover_photo_id ? (
          <button
            disabled={busy}
            onClick={() =>
              change(`/api/recipes/${id}`, "PUT", { cover_photo_id: null })
            }
          >
            Clear manual cover
          </button>
        ) : null}
        {!recipe.photos.length ? (
          <p className="photo-empty">No photos yet</p>
        ) : (
          <div className="photo-grid">
            {recipe.photos.map((photo) => (
              <div className="photo-card" key={photo.id}>
                <a href={photo.url} target="_blank" rel="noreferrer">
                  <img
                    src={photo.thumbnail_url}
                    alt={photo.original_filename}
                    loading="lazy"
                  />
                </a>
                <p className="photo-meta">
                  {photo.uploader_name} ·{" "}
                  <time dateTime={photo.created_at}>
                    {new Date(photo.created_at).toLocaleString()}
                  </time>
                </p>
                <div className="actions">
                  {photo.is_cover ? (
                    <span className="cover-badge">Cover photo</span>
                  ) : null}
                  {mine ? (
                    <button
                      className="quiet"
                      disabled={
                        busy || recipe.manual_cover_photo_id === photo.id
                      }
                      onClick={() =>
                        change(`/api/recipes/${id}`, "PUT", {
                          cover_photo_id: photo.id,
                        })
                      }
                    >
                      Set as cover
                    </button>
                  ) : null}
                  {mine || photo.uploaded_by === user.id ? (
                    <button
                      className="quiet danger"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm("Delete this photo?"))
                          change(`/api/photos/${photo.id}`, "DELETE");
                      }}
                    >
                      Delete photo
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="panel comments-section no-print">
        <h2>Comments</h2>
        {!recipe.comments.length ? (
          <p>No comments yet</p>
        ) : (
          recipe.comments.map((comment) => (
            <Comment
              key={comment.id}
              comment={comment}
              canEdit={comment.author_id === user.id}
              canDelete={mine || comment.author_id === user.id}
              busy={busy}
              change={change}
            />
          ))
        )}
        <CommentForm
          busy={busy}
          onSave={(text) =>
            change(`/api/recipes/${id}/comments`, "POST", { text })
          }
        />
      </section>
      {busy ? (
        <p role="status" className="no-print">
          Saving changes…
        </p>
      ) : null}
      {mine ? (
        <div className="delete-recipe no-print">
          <button className="quiet danger" disabled={busy} onClick={remove}>
            Delete recipe
          </button>
        </div>
      ) : null}
    </article>
  );
}

function CommentForm({ busy, onSave, initialText = "", onCancel }) {
  const fieldId = useId();
  const [text, setText] = useState(initialText);
  return (
    <form
      className="comment-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (await onSave(text)) setText("");
      }}
    >
      <label htmlFor={fieldId}>Comment</label>
      <textarea
        id={fieldId}
        value={text}
        onChange={(event) => setText(event.target.value)}
        required
        maxLength={2000}
        disabled={busy}
      />
      <div className="actions">
        <button disabled={busy || !text.trim()}>
          {onCancel ? "Save comment" : "Add comment"}
        </button>
        {onCancel ? (
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
function Comment({ comment, canEdit, canDelete, busy, change }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="comment">
      <p className="comment-meta">
        {comment.author_name} ·{" "}
        <time dateTime={comment.created_at}>
          {new Date(comment.created_at).toLocaleString()}
        </time>
        {comment.updated_at !== comment.created_at ? " · Edited" : null}
      </p>
      {editing ? (
        <CommentForm
          busy={busy}
          initialText={comment.text}
          onCancel={() => setEditing(false)}
          onSave={async (text) => {
            const saved = await change(`/api/comments/${comment.id}`, "PUT", {
              text,
            });
            if (saved) setEditing(false);
            return saved;
          }}
        />
      ) : (
        <p className="comment-text">{comment.text}</p>
      )}
      <div className="actions">
        {canEdit && !editing ? (
          <button disabled={busy} onClick={() => setEditing(true)}>
            Edit comment
          </button>
        ) : null}
        {canDelete ? (
          <button
            className="quiet danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Delete this comment?"))
                change(`/api/comments/${comment.id}`, "DELETE");
            }}
          >
            Delete comment
          </button>
        ) : null}
      </div>
    </div>
  );
}
