import express from "express";
import morgan from "morgan";
import client from "prom-client";

const app = express();
const PORT = process.env.PORT || 4001;

// Nome “humano” do serviço
const SERVICE_NAME = process.env.SERVICE_NAME || "users-service";

// Prefixo válido para métricas (só letras, números e _)
const METRIC_PREFIX =
  (SERVICE_NAME || "service").replace(/[^a-zA-Z0-9_]/g, "_") + "_";

app.use(express.json());
app.use(morgan("dev"));

// ----- PROMETHEUS METRICS -----
const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: METRIC_PREFIX });

const httpRequestDuration = new client.Histogram({
  name: `${METRIC_PREFIX}http_request_duration_seconds`,
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"]
});

const httpRequestsTotal = new client.Counter({
  name: `${METRIC_PREFIX}http_requests_total`,
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status_code"]
});

register.registerMetric(httpRequestDuration);
register.registerMetric(httpRequestsTotal);

app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer();
  res.on("finish", () => {
    const labels = {
      method: req.method,
      route: req.route?.path || req.path || "unknown",
      status_code: res.statusCode
    };
    end(labels);
    httpRequestsTotal.inc(labels);
  });
  next();
});

// ----- ROTAS -----
app.get("/health", (req, res) => {
  res.json({
    service: SERVICE_NAME,
    status: "ok",
    timestamp: new Date().toISOString()
  });
});

app.get("/users/demo", (req, res) => {
  res.json({
    service: SERVICE_NAME,
    users: [
      { id: 1, name: "Alice", role: "admin" },
      { id: 2, name: "Bob", role: "viewer" }
    ]
  });
});

app.get("/metrics", async (req, res) => {
  try {
    res.set("Content-Type", register.contentType);
    const metrics = await register.metrics();
    res.send(metrics);
  } catch (err) {
    console.error("Error generating metrics:", err);
    res.status(500).send("Error generating metrics");
  }
});

app.listen(PORT, () => {
  console.log(`[${SERVICE_NAME}] up on :${PORT}`);
});
