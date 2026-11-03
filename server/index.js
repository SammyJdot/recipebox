import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { createLogger } from "./logging.js";
const log = createLogger();
try {
  const config = loadConfig();
  const { app, data } = createApp(config, { log });
  const server = app.listen(config.port, "0.0.0.0", () =>
    log("info", "service.started", { version: config.version }),
  );
  const stop = () => {
    server.close(() => {
      data.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
} catch (error) {
  // Only validation errors use fixed configuration key names, never values.
  log("error", "service.start_failed", {
    message: error.message.startsWith("Missing environment variable:")
      ? error.message
      : "Invalid configuration or unavailable data directory",
  });
  process.exitCode = 1;
}
