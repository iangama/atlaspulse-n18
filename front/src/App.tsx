import { useEffect, useState } from "react";
import axios from "axios";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer
} from "recharts";

const GATEWAY_BASE =
  (import.meta.env.VITE_GATEWAY_BASE as string | undefined) ||
  "http://localhost:8880";

type HealthService = {
  name: string;
  url: string;
  status: string;
  latencyMs: number;
  lastCheck: string;
};

type HealthGraph = {
  timestamp: string;
  services: HealthService[];
};

type PromResult = any;

type LogItem = {
  ts: string;
  service: string;
  level: string;
  msg: string;
};

type TraceItem = {
  traceId: string;
  rootService: string;
  durationMs: number;
  timestamp: string;
};

type LogsResponse = { items: LogItem[] };
type TracesResponse = { items: TraceItem[] };

function App() {
  const [activeTab, setActiveTab] = useState<"overview" | "logs" | "traces">(
    "overview"
  );

  const [health, setHealth] = useState<HealthGraph | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const [promQuery, setPromQuery] = useState<string>("up");
  const [promLoading, setPromLoading] = useState(false);
  const [promResult, setPromResult] = useState<PromResult | null>(null);
  const [promError, setPromError] = useState<string | null>(null);

  const [logs, setLogs] = useState<LogItem[]>([]);
  const [traces, setTraces] = useState<TraceItem[]>([]);

  useEffect(() => {
    fetchHealth();
    const id = setInterval(fetchHealth, 10000);
    return () => clearInterval(id);
  }, []);

  async function fetchHealth() {
    try {
      setHealthLoading(true);
      const r = await axios.get<HealthGraph>(`${GATEWAY_BASE}/obs/healthgraph`);
      setHealth(r.data);
    } catch (err) {
      console.error("Failed to load healthgraph", err);
    } finally {
      setHealthLoading(false);
    }
  }

  async function runPromQuery() {
    if (!promQuery.trim()) return;
    setPromLoading(true);
    setPromError(null);
    setPromResult(null);
    try {
      const r = await axios.get(`${GATEWAY_BASE}/obs/query`, {
        params: { query: promQuery }
      });
      setPromResult(r.data);
    } catch (err: any) {
      console.error("PromQL query failed", err);
      setPromError(err?.message || "Error querying Prometheus");
    } finally {
      setPromLoading(false);
    }
  }

  async function loadLogs() {
    try {
      const r = await axios.get<LogsResponse>(`${GATEWAY_BASE}/obs/logs`);
      setLogs(r.data.items || []);
    } catch (err) {
      console.error("Failed to fetch logs", err);
    }
  }

  async function loadTraces() {
    try {
      const r = await axios.get<TracesResponse>(`${GATEWAY_BASE}/obs/traces`);
      setTraces(r.data.items || []);
    } catch (err) {
      console.error("Failed to fetch traces", err);
    }
  }

  const chartData = (() => {
    if (!promResult || promResult.status !== "success") return [];
    const data = promResult.data;
    if (!data || data.resultType !== "vector") return [];
    const vector = data.result as any[];
    return vector.map((item, index) => {
      const value = parseFloat(item.value?.[1] ?? "0");
      return {
        idx: index,
        value,
        metric: Object.entries(item.metric ?? {})
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")
      };
    });
  })();

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <div className="app-title">AtlasPulse</div>
          <div className="app-subtitle">
            Nível 18 – Observabilidade unificada (métricas, healthgraph, logs, traces)
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="badge">Nível 18</span>
          <div className="tabs">
            <button
              className={`tab-btn ${activeTab === "overview" ? "active" : ""}`}
              onClick={() => setActiveTab("overview")}
            >
              Overview
            </button>
            <button
              className={`tab-btn ${activeTab === "logs" ? "active" : ""}`}
              onClick={() => {
                setActiveTab("logs");
                loadLogs();
              }}
            >
              Logs
            </button>
            <button
              className={`tab-btn ${activeTab === "traces" ? "active" : ""}`}
              onClick={() => {
                setActiveTab("traces");
                loadTraces();
              }}
            >
              Traces
            </button>
          </div>
        </div>
      </header>

      {activeTab === "overview" && (
        <section className="card-grid">
          <div className="card">
            <h3>Healthgraph</h3>
            <small>
              Matriz de saúde em tempo real – fonte: <code>/obs/healthgraph</code>
            </small>

            <button
              className="btn"
              style={{ marginTop: 10 }}
              onClick={fetchHealth}
              disabled={healthLoading}
            >
              {healthLoading ? "Atualizando..." : "Atualizar agora"}
            </button>

            <div style={{ marginTop: 12 }}>
              {health?.services?.map((svc) => (
                <div
                  key={svc.name}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: "0.8rem",
                    padding: "4px 0",
                    borderBottom: "1px solid rgba(31,41,55,0.7)"
                  }}
                >
                  <div>
                    <strong>{svc.name}</strong>
                    <div style={{ fontSize: "0.7rem", color: "#9ca3af" }}>
                      {svc.url}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="health-status">
                      <span
                        className={
                          svc.status === "ok" ? "health-ok" : "health-down"
                        }
                      >
                        {svc.status.toUpperCase()}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: "0.7rem",
                        color: "#9ca3af",
                        marginTop: 2
                      }}
                    >
                      {svc.latencyMs.toFixed(0)} ms
                    </div>
                  </div>
                </div>
              ))}
              {!health && !healthLoading && (
                <div style={{ fontSize: "0.8rem", color: "#9ca3af" }}>
                  Nenhum dado ainda. Clique em <b>Atualizar agora</b>.
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <h3>Leitor de métricas (PromQL)</h3>
            <small>
              FRONT → <code>/obs/query?query=&lt;PROMQL&gt;</code> → Prometheus
            </small>

            <div className="metrics-panel">
              <div className="metrics-form">
                <input
                  className="metrics-input"
                  placeholder="Ex: up ou sum by (job) (up)"
                  value={promQuery}
                  onChange={(e) => setPromQuery(e.target.value)}
                />
                <button
                  className="btn"
                  onClick={runPromQuery}
                  disabled={promLoading}
                >
                  {promLoading ? "Consultando..." : "Rodar PromQL"}
                </button>
              </div>

              {promError && (
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "#fecaca",
                    marginBottom: 6
                  }}
                >
                  {promError}
                </div>
              )}

              <div style={{ height: 160, marginBottom: 8 }}>
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <XAxis dataKey="idx" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{
                          background: "#020617",
                          border: "1px solid #374151",
                          fontSize: 11
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        dot={false}
                        strokeWidth={1.8}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="small-caption">
                    Sem dados gráficos (usa vetores instantâneos). Tente
                    consultas simples como <code>up</code>.
                  </div>
                )}
              </div>

              <div className="metrics-result">
                <pre style={{ margin: 0 }}>
                  {promResult
                    ? JSON.stringify(promResult, null, 2)
                    : "// Resultado JSON do Prometheus aparecerá aqui"}
                </pre>
              </div>
            </div>
          </div>

          <div className="card">
            <h3>Resumo rápido</h3>
            <small>Nível 18 construído em cima do Aurion (N17)</small>
            <div style={{ marginTop: 8, fontSize: "0.8rem" }}>
              <ul style={{ paddingLeft: 18, margin: 0 }}>
                <li>Gateway expondo <code>/obs/query</code> e healthgraph</li>
                <li>Microserviços com <code>/metrics</code> Prometheus</li>
                <li>Prometheus coletando tudo a cada 5s</li>
                <li>Frontend React com dashboard em tempo real</li>
              </ul>
            </div>
            <span className="tag">AtlasPulse · Full Observability</span>
          </div>
        </section>
      )}

      {activeTab === "logs" && (
        <section className="card">
          <div className="section-title">Logs (demo)</div>
          <div className="small-caption">
            Endpoint: <code>/obs/logs</code>. Integração real com Loki pode ser
            plugada aqui depois.
          </div>
          <button className="btn" onClick={loadLogs}>
            Recarregar logs
          </button>
          <div style={{ marginTop: 12, fontSize: "0.8rem" }}>
            {logs.map((l, idx) => (
              <div
                key={idx}
                style={{
                  borderBottom: "1px solid rgba(31,41,55,0.7)",
                  padding: "4px 0"
                }}
              >
                <div>
                  <strong>[{l.level.toUpperCase()}]</strong>{" "}
                  <span style={{ color: "#9ca3af" }}>{l.service}</span>
                </div>
                <div>{l.msg}</div>
                <div style={{ fontSize: "0.7rem", color: "#9ca3af" }}>
                  {l.ts}
                </div>
              </div>
            ))}
            {logs.length === 0 && (
              <div style={{ color: "#9ca3af" }}>
                Nenhum log carregado ainda. Clique em{" "}
                <strong>Recarregar logs</strong>.
              </div>
            )}
          </div>
        </section>
      )}

      {activeTab === "traces" && (
        <section className="card">
          <div className="section-title">Traces (demo)</div>
          <div className="small-caption">
            Endpoint: <code>/obs/traces</code>. Integração com Jaeger pode ser
            ligada depois.
          </div>
          <button className="btn" onClick={loadTraces}>
            Recarregar traces
          </button>
          <div style={{ marginTop: 12, fontSize: "0.8rem" }}>
            {traces.map((t) => (
              <div
                key={t.traceId}
                style={{
                  borderBottom: "1px solid rgba(31,41,55,0.7)",
                  padding: "4px 0"
                }}
              >
                <div>
                  <strong>{t.traceId}</strong>
                </div>
                <div>
                  Serviço raiz:{" "}
                  <span style={{ color: "#9ca3af" }}>{t.rootService}</span>
                </div>
                <div>Duração: {t.durationMs} ms</div>
                <div style={{ fontSize: "0.7rem", color: "#9ca3af" }}>
                  {t.timestamp}
                </div>
              </div>
            ))}
            {traces.length === 0 && (
              <div style={{ color: "#9ca3af" }}>
                Nenhum trace carregado ainda. Clique em{" "}
                <strong>Recarregar traces</strong>.
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

export default App;
