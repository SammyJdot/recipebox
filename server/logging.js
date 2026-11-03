import { randomUUID } from "node:crypto";
export function createLogger(
  write = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`),
) {
  return (level, event, fields = {}) =>
    write({
      timestamp: new Date().toISOString(),
      level,
      service: "recipebox",
      request_id: null,
      event,
      ...fields,
    });
}
export function requestLogging(log) {
  return (req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    const start = performance.now();
    res.on("finish", () =>
      log("info", "http.request", {
        request_id: req.requestId,
        method: req.method,
        // Route templates prevent OAuth codes and user input from entering logs.
        path:
          req.baseUrl && req.route
            ? `${req.baseUrl}${req.route.path}`
            : req.route?.path || "/unmatched",
        status: res.statusCode,
        duration_ms: Math.round(performance.now() - start),
        ...(req.user ? { user_id: req.user.id } : {}),
      }),
    );
    next();
  };
}
export function auditHelper(data, log) {
  return (
    req,
    action,
    entityType,
    entityId,
    detail,
    work = () => undefined,
    actor = req.user,
  ) => {
    const events = [];
    const record = (event, type, id, summary) => {
      data.audit(actor, event, type, id, summary);
      events.push({ event, entity_type: type, entity_id: id, detail: summary });
    };
    const value = data.transaction(() => {
      const result = work(record);
      const resolvedId =
        typeof entityId === "function" ? entityId(result) : entityId;
      record(action, entityType, resolvedId, detail);
      return result;
    });
    for (const { event, ...fields } of events) {
      log("info", event, {
        request_id: req.requestId,
        ...(actor ? { user_id: actor.id } : {}),
        ...fields,
      });
    }
    return value;
  };
}
export function requireAdmin(req, res, next) {
  if (!req.user)
    return res
      .status(401)
      .json({ message: "Login required", request_id: req.requestId });
  if (req.user.role !== "admin")
    return res
      .status(403)
      .json({ message: "Admin role required", request_id: req.requestId });
  next();
}
