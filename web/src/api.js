let csrf;
export async function authConfig() {
  const response = await fetch("/auth/config", { credentials: "same-origin" });
  if (!response.ok) throw new Error("Unable to connect to RecipeBox");
  const config = await response.json();
  csrf = config.csrf_token;
  return config;
}
export async function api(path, options = {}) {
  const { body, method = "GET", ...other } = options;
  const headers = { ...other.headers };
  if (method !== "GET") {
    if (!csrf) await authConfig();
    headers["X-CSRF-Token"] = csrf;
  }
  const form = body instanceof FormData;
  if (body && !form) headers["Content-Type"] = "application/json";
  const response = await fetch(path, {
    ...other,
    method,
    headers,
    credentials: "same-origin",
    body: body ? (form ? body : JSON.stringify(body)) : undefined,
  });
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    if (response.status === 401 && path.startsWith("/api/"))
      window.dispatchEvent(new Event("session-expired"));
    throw new Error(
      `${result.message || "Request failed"}${result.request_id ? ` (request ${result.request_id})` : ""}`,
    );
  }
  if (result?.csrf_token) csrf = result.csrf_token;
  return result;
}
