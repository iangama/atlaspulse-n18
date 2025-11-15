import express from "express";
import cors from "cors";
import axios from "axios";
import client from "prom-client";

const app = express();
const PORT = process.env.PORT || 4000;
const PROM_URL = process.env.PROM_URL || "http://prometheus:9090";

// SERVICE_TARGETS exemplo: "users=http://users-service:4001,orders=http://orders-service:4002"
const SERVICE_TARGETS = process.env.SERVICE_TARGETS || "users=http://users-service:4001";

const parsedTargets = SERVICE_TARGETS.split(",")
  .filter(Boolean)
  .map((pair) => {
    const [name, url] = pair.split("=");
    return { name: name.trim(), baseUrl: url.trim() };
  });

app.use(express.json());
app.use(cors());

// ----- PROMETHEUS METRICS DO GATEWAY -----
const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: "gateway_" });

const httpRequestDuration = new client.Histogram({
  name: "gateway_http_request_duration_seconds",
  help: "HTTP request duration in seconds (gateway)",
  labelNames: ["method", "route", "status_code"]
});

const httpRequestsTotal = new client.Counter({
  name: "gateway_http_requests_total",
  help: "Total HTTP requests (gateway)",
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

// ----- LOGS EM MEMÓRIA -----
const logsBuffer = [];
const MAX_LOGS = 200;

function addLog(entry) {
  logsBuffer.push({
    ts: new Date().toISOString(),
    level: entry.level || "info",
    service: entry.service || "gateway",
    msg: entry.msg || ""
  });
  if (logsBuffer.length > MAX_LOGS) {
    logsBuffer.shift();
  }
}

// log de inicialização
addLog({ level: "info", service: "gateway", msg: "Gateway started" });

// ----- /health -----
app.get("/health", (req, res) => {
  res.json({
    service: "gateway",
    status: "ok",
    timestamp: new Date().toISOString(),
    services: parsedTargets.map((s) => s.name)
  });
});

// ----- /metrics -----
app.get("/metrics", async (req, res) => {
  try {
    res.set("Content-Type", register.contentType);
    const metrics = await register.metrics();
    res.send(metrics);
  } catch (err) {
    console.error("Error generating gateway metrics:", err);
    res.status(500).send("Error generating metrics");
  }
});

// ----- /obs/query -> Prometheus (PROMQL) -----
app.get("/obs/query", async (req, res) => {
  const { query } = req.query;
  if (!query) {
    return res.status(400).json({ error: "Missing PromQL query" });
  }

  try {
    const r = await axios.get(`${PROM_URL}/api/v1/query`, {
      params: { query }
    });

    addLog({
      level: "info",
      service: "gateway",
      msg: `PromQL query executed: "${query}"`
    });

    res.json(r.data); // repassa JSON direto
  } catch (err) {
    console.error("Error querying Prometheus:", err.message);
    addLog({
      level: "error",
      service: "gateway",
      msg: `PromQL query failed: "${query}" - ${err.message}`
    });
    res.status(500).json({ error: "Failed to query Prometheus" });
  }
});

// ----- /obs/healthgraph -----
app.get("/obs/healthgraph", async (req, res) => {
  const results = await Promise.all(
    parsedTargets.map(async (svc) => {
      const start = Date.now();
      try {
        const r = await axios.get(`${svc.baseUrl}/health`, { timeout: 2000 });
        const durationMs = Date.now() - start;

        addLog({
          level: "info",
          service: svc.name,
          msg: `Healthcheck ok (${durationMs}ms)`
        });

        return {
          name: svc.name,
          url: svc.baseUrl,
          status: r.data?.status || "unknown",
          latencyMs: durationMs,
          lastCheck: new Date().toISOString()
        };
      } catch (err) {
        const durationMs = Date.now() - start;

        addLog({
          level: "error",
          service: svc.name,
          msg: `Healthcheck failed (${durationMs}ms): ${err.message}`
        });

        return {
          name: svc.name,
          url: svc.baseUrl,
          status: "down",
          latencyMs: durationMs,
          error: err.message,
          lastCheck: new Date().toISOString()
        };
      }
    })
  );

  res.json({
    timestamp: new Date().toISOString(),
    services: results
  });
});

// ----- /obs/logs (agora com logs reais em memória) -----
app.get("/obs/logs", (req, res) => {
  // mais recentes primeiro
  const items = [...logsBuffer].reverse();
  res.json({ items });
});

// ----- /obs/traces (continua demo – Jaeger real fica para N19) -----
app.get("/obs/traces", (req, res) => {
  res.json({
    items: [
      {
        traceId: "demo-trace-123",
        rootService: "users",
        durationMs: 42,
        timestamp: new Date().toISOString()
      }
    ]
  });
});

app.listen(PORT, () => {
  console.log(`[gateway] up on :${PORT}`);
  console.log("Targets:", parsedTargets);
});
