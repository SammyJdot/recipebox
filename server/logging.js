import { randomUUID } from "node:crypto";
export function createLogger(
  write = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`),
) {
  return (level, event, fields = {}) =>
    write({
      timestamp: new Date().toISOString(),
      level,
      service: "recipebox",
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
    let resolvedId = entityId;
    const value = data.transaction(() => {
      const result = work();
      if (typeof entityId === "function") resolvedId = entityId(result);
      data.audit(actor, action, entityType, resolvedId, detail);
      return result;
    });
    log("info", action, {
      request_id: req.requestId,
      ...(actor ? { user_id: actor.id } : {}),
      entity_type: entityType,
      entity_id: resolvedId,
      detail,
    });
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
