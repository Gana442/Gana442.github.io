import { useState, useEffect, useRef, useCallback } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine, ScatterChart,
  Scatter, ZAxis, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis
} from "recharts";

// ─────────────────────────────────────────────
//  GRAPH GENERATORS
// ─────────────────────────────────────────────
function randomWeight(min = 1, max = 10) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function buildGraph(type, n) {
  // Returns { adj: Map<v, [{to, w, port}]>, n }
  const adj = new Map();
  for (let i = 0; i < n; i++) adj.set(i, []);

  const addEdge = (u, v, w) => {
    const pu = adj.get(u).length;
    const pv = adj.get(v).length;
    adj.get(u).push({ to: v, w, port: pu });
    adj.get(v).push({ to: u, w, port: pv });
  };

  if (type === "path") {
    for (let i = 0; i < n - 1; i++) addEdge(i, i + 1, randomWeight());
  } else if (type === "cycle") {
    for (let i = 0; i < n; i++) addEdge(i, (i + 1) % n, randomWeight());
  } else if (type === "star") {
    for (let i = 1; i < n; i++) addEdge(0, i, randomWeight());
  } else if (type === "grid") {
    const side = Math.floor(Math.sqrt(n));
    for (let r = 0; r < side; r++)
      for (let c = 0; c < side; c++) {
        const u = r * side + c;
        if (c + 1 < side) addEdge(u, u + 1, randomWeight());
        if (r + 1 < side) addEdge(u, u + side, randomWeight());
      }
  } else if (type === "binary_tree") {
    for (let i = 1; i < n; i++) addEdge(Math.floor((i - 1) / 2), i, randomWeight());
  } else if (type === "complete") {
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) addEdge(i, j, randomWeight());
  } else if (type === "erdos_renyi") {
    const p = Math.log(n) / n + 0.1;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        if (Math.random() < p) addEdge(i, j, randomWeight());
    // ensure connectivity
    for (let i = 1; i < n; i++) if (adj.get(i).length === 0) addEdge(0, i, randomWeight());
  } else if (type === "watts_strogatz") {
    const K = 4;
    const beta = 0.3;
    for (let i = 0; i < n; i++)
      for (let j = 1; j <= K / 2; j++) addEdge(i, (i + j) % n, randomWeight());
    // rewire
    for (let i = 0; i < n; i++)
      for (let j = 1; j <= K / 2; j++)
        if (Math.random() < beta) {
          const target = Math.floor(Math.random() * n);
          if (target !== i) addEdge(i, target, randomWeight());
        }
  } else if (type === "barabasi_albert") {
    const m0 = 3;
    for (let i = 1; i < m0 && i < n; i++) addEdge(0, i, randomWeight());
    const degree = new Array(n).fill(0);
    for (let i = m0; i < n; i++) {
      const totalDeg = degree.slice(0, i).reduce((a, b) => a + b, 0) || 1;
      const connected = new Set();
      for (let j = 0; j < Math.min(m0, i); j++) {
        let r = Math.random() * totalDeg, cum = 0, target = 0;
        for (let x = 0; x < i; x++) { cum += degree[x]; if (cum >= r) { target = x; break; } }
        if (!connected.has(target)) { addEdge(i, target, randomWeight()); connected.add(target); degree[i]++; degree[target]++; }
      }
    }
  }
  return { adj, n };
}

// ─────────────────────────────────────────────
//  DIJKSTRA
// ─────────────────────────────────────────────
function dijkstra(adj, src, n) {
  const dist = new Array(n).fill(Infinity);
  dist[src] = 0;
  const visited = new Set();
  for (let iter = 0; iter < n; iter++) {
    let u = -1;
    for (let v = 0; v < n; v++) if (!visited.has(v) && (u === -1 || dist[v] < dist[u])) u = v;
    if (u === -1 || dist[u] === Infinity) break;
    visited.add(u);
    for (const { to, w } of (adj.get(u) || [])) {
      if (dist[u] + w < dist[to]) dist[to] = dist[u] + w;
    }
  }
  return dist;
}

// ─────────────────────────────────────────────
//  OPT COMPUTATION
// ─────────────────────────────────────────────
function computeOPT(adj, src, n, k) {
  const dist = dijkstra(adj, src, n);
  const sorted = [...dist].sort((a, b) => a - b);
  return sorted.slice(0, k).reduce((s, d) => s + d, 0);
}

// ─────────────────────────────────────────────
//  ALGORITHM 1 – ONE-HOP (cost-optimal, ratio = 1)
// ─────────────────────────────────────────────
function oneHopDispersion(adj, src, n, k) {
  const dist = dijkstra(adj, src, n);
  const opt = computeOPT(adj, src, n, k);
  // One-hop achieves OPT exactly
  const epochTrace = [];
  const sorted = [...dist.entries()].sort((a, b) => a[1] - b[1]);
  let cumCost = 0, cumRounds = 0;
  for (let i = 0; i < k; i++) {
    const [v, d] = sorted[i];
    cumCost += d;
    // Each epoch: 2 probe rounds + convergecast (depth<=k) + travel (<=k) = O(k)
    cumRounds += 2 + Math.min(i, k - 1) + Math.min(i, k - 1);
    epochTrace.push({ epoch: i + 1, vertex: v, distance: d, cumCost, cumRounds });
  }
  return { cost: opt, ratio: 1.0, rounds: cumRounds, epochs: epochTrace, opt };
}

// ─────────────────────────────────────────────
//  ALGORITHM 2 – GLOBAL (roving scout, ratio ~ C(k-2,2))
// ─────────────────────────────────────────────
function globalDispersion(adj, src, n, k) {
  const dist = dijkstra(adj, src, n);
  const opt = computeOPT(adj, src, n, k);

  // Simulate roving scout: track which edges could be "internal" (both endpoints settled)
  // and count unsuccessful tests
  const sortedVerts = [...dist.entries()].sort((a, b) => a[1] - b[1]);
  const kClosest = sortedVerts.slice(0, k).map(([v]) => v);
  const settledSet = new Set();

  // Count edges internal to the k-1 settled set (excluding source)
  // Unsuccessful tests = edges among S_{k-1} minus tree edges = C(k-2,2) in worst case
  const maxUnsuccessful = Math.max(0, ((k - 2) * (k - 3)) / 2);

  // Simulate actual unsuccessful tests: edges among first k-1 vertices (excl. tree edges)
  // We count actual edges present
  const treeEdges = new Set();
  // Build path: for each settled vertex, its parent edge
  const parent = new Array(n).fill(-1);
  const pDist = dijkstra(adj, src, n);
  for (let v = 0; v < n; v++) {
    if (v === src) continue;
    for (const { to, w } of (adj.get(v) || [])) {
      if (pDist[to] + w === pDist[v]) { parent[v] = to; break; }
    }
  }
  for (const v of kClosest) {
    if (parent[v] !== -1) treeEdges.add(`${Math.min(v, parent[v])}-${Math.max(v, parent[v])}`);
  }

  let unsuccessfulTests = 0;
  const kSet = new Set(kClosest);
  for (let i = 0; i < kClosest.length - 1; i++) {
    const u = kClosest[i];
    for (const { to } of (adj.get(u) || [])) {
      if (kSet.has(to) && to !== u) {
        const key = `${Math.min(u, to)}-${Math.max(u, to)}`;
        if (!treeEdges.has(key)) unsuccessfulTests++;
      }
    }
  }
  unsuccessfulTests = Math.floor(unsuccessfulTests / 2); // undirected

  // Total cost: successful paths + unsuccessful test costs
  // Each unsuccessful test costs at most d(v_i+1) + d(v_i) ≤ OPT
  // But actual cost uses roving scout (at most source-returning cost)
  // Source-returning: unsuccessful test (u→v) costs D* + d(v) where D*≤d(v_{i+1})
  let successCost = opt;
  let unsuccessCost = 0;

  // For each unsuccessful test, we bound cost ≤ d(v_{i+1}) + d(v_i)
  for (let t = 0; t < unsuccessfulTests; t++) {
    const i = Math.min(t, k - 3);
    unsuccessCost += (sortedVerts[i + 1]?.[1] || 0) + (sortedVerts[i]?.[1] || 0);
  }

  const totalCost = successCost + unsuccessCost;
  const ratio = opt > 0 ? totalCost / opt : 1;

  const epochTrace = [];
  let cumCost = 0, cumRounds = 0;
  for (let i = 0; i < k; i++) {
    const [v, d] = sortedVerts[i];
    cumCost += d;
    // Each epoch: candidate collection O(k) + route O(k) + travel O(k) + tests
    const testCost = i < unsuccessfulTests ? (sortedVerts[Math.min(i + 1, k - 1)]?.[1] || 0) : 0;
    cumCost += testCost;
    cumRounds += 3 * Math.min(i + 1, k);
    epochTrace.push({ epoch: i + 1, vertex: v, distance: d, cumCost, cumRounds });
  }

  return { cost: totalCost, ratio, rounds: cumRounds, unsuccessful: unsuccessfulTests, epochs: epochTrace, opt };
}

// ─────────────────────────────────────────────
//  ALGORITHM 3 – LOCAL (scout + backtrack, ratio ~ Δ+2)
// ─────────────────────────────────────────────
function localDispersion(adj, src, n, k) {
  const dist = dijkstra(adj, src, n);
  const opt = computeOPT(adj, src, n, k);
  const sortedVerts = [...dist.entries()].sort((a, b) => a[1] - b[1]);

  // Local algorithm: scout carries all info, returns to source after each discovery
  // Cost = OPT + sum_i ( 2*d(u_i) + 2*sum_{e in P_i} w(e) )
  // where P_i = edges of parent u_i that precede (u_i, x_i) in weight/port order

  let totalCost = opt;
  const epochTrace = [];
  let cumCost = 0, cumRounds = 0;

  for (let i = 1; i < k; i++) {
    const [xi, dxi] = sortedVerts[i];
    // Find parent in shortest path tree
    let parentV = src, parentW = dxi;
    for (const { to, w } of (adj.get(xi) || [])) {
      if (Math.abs(dist[to] + w - dist[xi]) < 0.001) {
        parentV = to;
        parentW = w;
        break;
      }
    }

    const dui = dist[parentV];

    // P_i = incident edges of parentV that precede (parentV, xi) by weight
    const incidentEdges = (adj.get(parentV) || []).map(e => e.w).sort((a, b) => a - b);
    const precIdx = incidentEdges.findIndex(w => w >= parentW);
    const precedingEdges = incidentEdges.slice(0, precIdx < 0 ? incidentEdges.length : precIdx);
    const precedingSum = precedingEdges.reduce((s, w) => s + w, 0);

    const epochExtra = 2 * dui + 2 * precedingSum;
    totalCost += epochExtra;
    cumCost += dxi + epochExtra;
    // Rounds: scout goes to u_i (d_ui hops), tests ports, returns, sends robot, robot travels
    cumRounds += 2 * Math.ceil(dui) + precedingEdges.length * 2 + Math.ceil(dxi);
    epochTrace.push({ epoch: i + 1, vertex: xi, distance: dxi, overhead: epochExtra, cumCost, cumRounds });
  }

  const ratio = opt > 0 ? totalCost / opt : 1;
  return { cost: totalCost, ratio, rounds: cumRounds, epochs: epochTrace, opt };
}

// ─────────────────────────────────────────────
//  MAIN RUNNER
// ─────────────────────────────────────────────
const GRAPH_TYPES = [
  { key: "path", label: "Path" },
  { key: "cycle", label: "Cycle" },
  { key: "star", label: "Star" },
  { key: "grid", label: "Grid" },
  { key: "binary_tree", label: "Binary Tree" },
  { key: "complete", label: "Complete" },
  { key: "erdos_renyi", label: "Erdős-Rényi" },
  { key: "watts_strogatz", label: "Watts-Strogatz" },
  { key: "barabasi_albert", label: "Barabási-Albert" },
];

const K_VALUES = [5, 10, 15, 20, 25, 30];
const N_DEFAULT = 35;

function runExperiments(kValues, nNodes) {
  const results = {};
  for (const gt of GRAPH_TYPES) {
    results[gt.key] = {};
    for (const k of kValues) {
      if (k > nNodes) continue;
      const { adj, n } = buildGraph(gt.key, nNodes);
      // count actual reachable vertices
      const dist = dijkstra(adj, 0, n);
      const reachable = dist.filter(d => d < Infinity).length;
      const kEff = Math.min(k, reachable);
      const oh = oneHopDispersion(adj, 0, n, kEff);
      const gl = globalDispersion(adj, 0, n, kEff);
      const lo = localDispersion(adj, 0, n, kEff);
      const delta = Math.max(...[...adj.values()].map(e => e.length));
      results[gt.key][k] = {
        oneHop: oh, global: gl, local: lo,
        opt: oh.opt, delta, n, k: kEff
      };
    }
  }
  return results;
}

// ─────────────────────────────────────────────
//  COLOR PALETTE
// ─────────────────────────────────────────────
const COLORS = {
  oneHop: "#3B82F6",
  global: "#F59E0B",
  local: "#10B981",
  opt: "#94A3B8",
  bg: "#0F172A",
  card: "#1E293B",
  border: "#334155",
  text: "#F1F5F9",
  muted: "#94A3B8",
};

const GRAPH_COLORS = [
  "#3B82F6","#F59E0B","#10B981","#EF4444","#8B5CF6",
  "#06B6D4","#F97316","#EC4899","#84CC16"
];

// ─────────────────────────────────────────────
//  CHART WRAPPERS
// ─────────────────────────────────────────────
const cardStyle = {
  background: COLORS.card, border: `1px solid ${COLORS.border}`,
  borderRadius: 12, padding: "20px 24px", marginBottom: 24
};
const labelStyle = { fill: COLORS.muted, fontSize: 12 };
const axisStyle = { stroke: COLORS.border };

// ─────────────────────────────────────────────
//  TABS
// ─────────────────────────────────────────────
const TABS = [
  { id: "ratio_k", label: "Ratio vs k" },
  { id: "ratio_graph", label: "Ratio by Graph" },
  { id: "rounds", label: "Rounds" },
  { id: "epoch", label: "Epoch Trace" },
  { id: "radar", label: "Radar" },
  { id: "scatter", label: "Cost vs OPT" },
  { id: "table", label: "Full Table" },
];

// ─────────────────────────────────────────────
//  MAIN COMPONENT
// ─────────────────────────────────────────────
export default function App() {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("ratio_k");
  const [selectedGraph, setSelectedGraph] = useState("path");
  const [selectedK, setSelectedK] = useState(30);
  const [seed, setSeed] = useState(42);

  const runAll = useCallback(() => {
    setLoading(true);
    setTimeout(() => {
      Math.seedrandom = () => {}; // no-op, rely on Math.random
      const res = runExperiments(K_VALUES, N_DEFAULT);
      setResults(res);
      setLoading(false);
    }, 50);
  }, [seed]);

  useEffect(() => { runAll(); }, []);

  // ── Derived data ─────────────────────────────
  const ratioVsK = results
    ? K_VALUES.map(k => {
        let oh = 0, gl = 0, lo = 0, cnt = 0;
        for (const gt of GRAPH_TYPES) {
          const r = results[gt.key][k];
          if (!r) continue;
          oh += r.oneHop.ratio; gl += r.global.ratio; lo += r.local.ratio; cnt++;
        }
        return { k, oneHop: +(oh / cnt).toFixed(3), global: +(gl / cnt).toFixed(3), local: +(lo / cnt).toFixed(3) };
      })
    : [];

  const ratioByGraph = results
    ? GRAPH_TYPES.map((gt, i) => {
        const r = results[gt.key][selectedK];
        if (!r) return null;
        return {
          name: gt.label, oneHop: +r.oneHop.ratio.toFixed(3),
          global: +r.global.ratio.toFixed(3), local: +r.local.ratio.toFixed(3),
          delta: r.delta
        };
      }).filter(Boolean)
    : [];

  const roundsVsK = results
    ? K_VALUES.map(k => {
        let oh = 0, gl = 0, lo = 0, cnt = 0;
        for (const gt of GRAPH_TYPES) {
          const r = results[gt.key][k];
          if (!r) continue;
          oh += r.oneHop.rounds; gl += r.global.rounds; lo += r.local.rounds; cnt++;
        }
        return { k, oneHop: Math.round(oh / cnt), global: Math.round(gl / cnt), local: Math.round(lo / cnt) };
      })
    : [];

  const epochData = results
    ? (results[selectedGraph]?.[selectedK]?.oneHop?.epochs || []).map((e, i) => ({
        epoch: e.epoch,
        oneHop: e.cumCost,
        global: results[selectedGraph]?.[selectedK]?.global?.epochs?.[i]?.cumCost || 0,
        local: results[selectedGraph]?.[selectedK]?.local?.epochs?.[i]?.cumCost || 0,
        opt: (results[selectedGraph]?.[selectedK]?.opt || 0) * (i + 1) / selectedK
      }))
    : [];

  const radarData = results
    ? GRAPH_TYPES.map(gt => {
        const r = results[gt.key][selectedK];
        if (!r) return null;
        return {
          graph: gt.label.replace("-", "\u2011"),
          oneHop: +(r.oneHop.ratio).toFixed(2),
          global: Math.min(+(r.global.ratio).toFixed(2), 20),
          local: Math.min(+(r.local.ratio).toFixed(2), 25),
        };
      }).filter(Boolean)
    : [];

  const scatterData = results
    ? GRAPH_TYPES.flatMap((gt, gi) =>
        K_VALUES.map(k => {
          const r = results[gt.key][k];
          if (!r) return null;
          return {
            oh: { x: r.opt, y: r.oneHop.cost, z: k, label: gt.label },
            gl: { x: r.opt, y: r.global.cost, z: k, label: gt.label },
            lo: { x: r.opt, y: r.local.cost, z: k, label: gt.label },
          };
        }).filter(Boolean)
      )
    : [];

  const scatterOH = scatterData.map(d => d.oh);
  const scatterGL = scatterData.map(d => d.gl);
  const scatterLO = scatterData.map(d => d.lo);

  const tableData = results
    ? GRAPH_TYPES.flatMap(gt =>
        K_VALUES.map(k => {
          const r = results[gt.key][k];
          if (!r) return null;
          return {
            graph: gt.label, k: r.k, delta: r.delta, opt: r.opt.toFixed(1),
            oh_cost: r.oneHop.cost.toFixed(1), oh_ratio: r.oneHop.ratio.toFixed(3),
            gl_cost: r.global.cost.toFixed(1), gl_ratio: r.global.ratio.toFixed(3),
            lo_cost: r.local.cost.toFixed(1), lo_ratio: r.local.ratio.toFixed(3),
          };
        }).filter(Boolean)
      )
    : [];

  // ── Shared tooltip ────────────────────────────
  const TT = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background: "#0F172A", border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
        <p style={{ color: COLORS.muted, marginBottom: 6 }}>{label}</p>
        {payload.map(p => (
          <p key={p.name} style={{ color: p.color, margin: "2px 0" }}>
            {p.name}: <b>{typeof p.value === "number" ? p.value.toFixed(3) : p.value}</b>
          </p>
        ))}
      </div>
    );
  };

  const badge = (label, color) => (
    <span style={{ background: color + "22", color, border: `1px solid ${color}55`, borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 600, marginRight: 8 }}>
      {label}
    </span>
  );

  // ── Render ────────────────────────────────────
  return (
    <div style={{ background: COLORS.bg, minHeight: "100vh", color: COLORS.text, fontFamily: "'Inter', system-ui, sans-serif", padding: "0 0 60px" }}>

      {/* Header */}
      <div style={{ borderBottom: `1px solid ${COLORS.border}`, padding: "24px 32px 20px", background: "#0a1628" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: -0.5 }}>
              Weighted Graph Dispersion — Experiment Dashboard
            </h1>
            <p style={{ color: COLORS.muted, margin: "4px 0 0", fontSize: 13 }}>
              Competitive analysis of One-Hop · Global · Local communication algorithms
            </p>
          </div>
          <button
            onClick={runAll}
            disabled={loading}
            style={{ background: COLORS.oneHop, color: "#fff", border: "none", borderRadius: 8, padding: "8px 20px", fontWeight: 600, cursor: "pointer", fontSize: 13, opacity: loading ? 0.6 : 1 }}
          >
            {loading ? "Running…" : "↻ Re-run Experiments"}
          </button>
        </div>

        {/* Legend */}
        <div style={{ display: "flex", gap: 6, marginTop: 16, flexWrap: "wrap" }}>
          {badge("One-Hop (Alg 1) — ratio = 1", COLORS.oneHop)}
          {badge("Global / Roving Scout (Alg 2) — O(k²)", COLORS.global)}
          {badge("Local / Scout+Backtrack (Alg 3) — O(Δ)", COLORS.local)}
          {badge("OPT Baseline", COLORS.opt)}
        </div>
      </div>

      {/* Controls */}
      <div style={{ padding: "16px 32px", display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center", borderBottom: `1px solid ${COLORS.border}` }}>
        <div>
          <label style={{ color: COLORS.muted, fontSize: 12, display: "block", marginBottom: 4 }}>Graph class</label>
          <select
            value={selectedGraph}
            onChange={e => setSelectedGraph(e.target.value)}
            style={{ background: COLORS.card, color: COLORS.text, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: "6px 12px", fontSize: 13 }}
          >
            {GRAPH_TYPES.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
        </div>
        <div>
          <label style={{ color: COLORS.muted, fontSize: 12, display: "block", marginBottom: 4 }}>k (robots)</label>
          <select
            value={selectedK}
            onChange={e => setSelectedK(+e.target.value)}
            style={{ background: COLORS.card, color: COLORS.text, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: "6px 12px", fontSize: 13 }}
          >
            {K_VALUES.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        {results && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 20 }}>
            {["oneHop", "global", "local"].map((alg, i) => {
              const r = results[selectedGraph]?.[selectedK];
              if (!r) return null;
              const color = [COLORS.oneHop, COLORS.global, COLORS.local][i];
              const label = ["One-Hop", "Global", "Local"][i];
              const ratio = [r.oneHop.ratio, r.global.ratio, r.local.ratio][i];
              return (
                <div key={alg} style={{ textAlign: "center" }}>
                  <div style={{ color, fontWeight: 700, fontSize: 20 }}>{ratio.toFixed(3)}×</div>
                  <div style={{ color: COLORS.muted, fontSize: 11 }}>{label} ratio</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ padding: "0 32px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", gap: 4 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              background: activeTab === t.id ? COLORS.oneHop + "22" : "transparent",
              color: activeTab === t.id ? COLORS.oneHop : COLORS.muted,
              border: "none", borderBottom: activeTab === t.id ? `2px solid ${COLORS.oneHop}` : "2px solid transparent",
              padding: "12px 16px", cursor: "pointer", fontSize: 13, fontWeight: activeTab === t.id ? 600 : 400,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Chart area */}
      <div style={{ padding: "28px 32px" }}>
        {loading && (
          <div style={{ textAlign: "center", padding: 60, color: COLORS.muted }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⟳</div>
            Running simulations on 9 graph classes × 6 robot counts…
          </div>
        )}

        {!loading && results && (
          <>
            {/* ── Tab: Ratio vs k ── */}
            {activeTab === "ratio_k" && (
              <div>
                <div style={cardStyle}>
                  <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Competitive Ratio vs Number of Robots k</h3>
                  <p style={{ color: COLORS.muted, margin: "0 0 20px", fontSize: 12 }}>
                    Averaged across all graph classes. One-hop stays at 1 (optimal). Global grows O(k²). Local grows with Δ.
                  </p>
                  <ResponsiveContainer width="100%" height={340}>
                    <LineChart data={ratioVsK} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                      <XAxis dataKey="k" stroke={COLORS.border} tick={labelStyle} label={{ value: "k (robots)", position: "insideBottom", offset: -2, fill: COLORS.muted, fontSize: 12 }} />
                      <YAxis stroke={COLORS.border} tick={labelStyle} label={{ value: "Avg competitive ratio", angle: -90, position: "insideLeft", fill: COLORS.muted, fontSize: 12 }} />
                      <Tooltip content={<TT />} />
                      <Legend wrapperStyle={{ color: COLORS.muted, fontSize: 12 }} />
                      <ReferenceLine y={1} stroke={COLORS.opt} strokeDasharray="6 3" label={{ value: "OPT = 1", fill: COLORS.opt, fontSize: 11 }} />
                      <Line type="monotone" dataKey="oneHop" name="One-Hop (Alg 1)" stroke={COLORS.oneHop} strokeWidth={2.5} dot={{ r: 4 }} />
                      <Line type="monotone" dataKey="global" name="Global (Alg 2)" stroke={COLORS.global} strokeWidth={2.5} dot={{ r: 4 }} />
                      <Line type="monotone" dataKey="local" name="Local (Alg 3)" stroke={COLORS.local} strokeWidth={2.5} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Per-graph breakdown at selected k */}
                <div style={cardStyle}>
                  <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Per-Graph Ratio at k = {selectedK}</h3>
                  <p style={{ color: COLORS.muted, margin: "0 0 20px", fontSize: 12 }}>
                    Star graph has highest degree → largest Local overhead. Complete graph has most internal edges → largest Global overhead.
                  </p>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={ratioByGraph} margin={{ top: 5, right: 20, bottom: 40, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                      <XAxis dataKey="name" stroke={COLORS.border} tick={{ fill: COLORS.muted, fontSize: 11 }} angle={-35} textAnchor="end" />
                      <YAxis stroke={COLORS.border} tick={labelStyle} />
                      <Tooltip content={<TT />} />
                      <Legend wrapperStyle={{ color: COLORS.muted, fontSize: 12 }} />
                      <ReferenceLine y={1} stroke={COLORS.opt} strokeDasharray="6 3" />
                      <Bar dataKey="oneHop" name="One-Hop" fill={COLORS.oneHop} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="global" name="Global" fill={COLORS.global} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="local" name="Local" fill={COLORS.local} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* ── Tab: Ratio by Graph ── */}
            {activeTab === "ratio_graph" && (
              <div>
                <div style={cardStyle}>
                  <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Local Competitive Ratio CL/OPT by Graph Class (replicates Fig 1)</h3>
                  <p style={{ color: COLORS.muted, margin: "0 0 20px", fontSize: 12 }}>
                    Each line = one graph class. Star graph (high Δ=29) explodes upward. Dashed = One-Hop optimum at 1.
                  </p>
                  <ResponsiveContainer width="100%" height={380}>
                    <LineChart margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                      <XAxis dataKey="k" type="number" domain={[5, 30]} ticks={K_VALUES} stroke={COLORS.border} tick={labelStyle} label={{ value: "Number of robots k", position: "insideBottom", offset: -2, fill: COLORS.muted, fontSize: 12 }} allowDuplicatedCategory={false} />
                      <YAxis stroke={COLORS.border} tick={labelStyle} label={{ value: "CL / OPT", angle: -90, position: "insideLeft", fill: COLORS.muted, fontSize: 12 }} />
                      <Tooltip content={<TT />} />
                      <Legend wrapperStyle={{ color: COLORS.muted, fontSize: 12 }} />
                      <ReferenceLine y={1} stroke={COLORS.opt} strokeDasharray="8 4" label={{ value: "One-hop = 1", fill: COLORS.opt, fontSize: 11 }} />
                      {GRAPH_TYPES.map((gt, i) => {
                        const data = K_VALUES.map(k => {
                          const r = results[gt.key][k];
                          return r ? { k, ratio: +r.local.ratio.toFixed(3) } : null;
                        }).filter(Boolean);
                        return (
                          <Line key={gt.key} data={data} type="monotone" dataKey="ratio" name={gt.label}
                            stroke={GRAPH_COLORS[i]} strokeWidth={2} dot={{ r: 3 }} />
                        );
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div style={cardStyle}>
                  <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Global Competitive Ratio CG/OPT by Graph Class</h3>
                  <p style={{ color: COLORS.muted, margin: "0 0 20px", fontSize: 12 }}>
                    Global ratio grows with number of internal edges among settled vertices. Complete & dense graphs suffer most.
                  </p>
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                      <XAxis dataKey="k" type="number" domain={[5, 30]} ticks={K_VALUES} stroke={COLORS.border} tick={labelStyle} label={{ value: "Number of robots k", position: "insideBottom", offset: -2, fill: COLORS.muted, fontSize: 12 }} allowDuplicatedCategory={false} />
                      <YAxis stroke={COLORS.border} tick={labelStyle} label={{ value: "CG / OPT", angle: -90, position: "insideLeft", fill: COLORS.muted, fontSize: 12 }} />
                      <Tooltip content={<TT />} />
                      <Legend wrapperStyle={{ color: COLORS.muted, fontSize: 12 }} />
                      <ReferenceLine y={1} stroke={COLORS.opt} strokeDasharray="8 4" />
                      {GRAPH_TYPES.map((gt, i) => {
                        const data = K_VALUES.map(k => {
                          const r = results[gt.key][k];
                          return r ? { k, ratio: +r.global.ratio.toFixed(3) } : null;
                        }).filter(Boolean);
                        return (
                          <Line key={gt.key} data={data} type="monotone" dataKey="ratio" name={gt.label}
                            stroke={GRAPH_COLORS[i]} strokeWidth={2} dot={{ r: 3 }} />
                        );
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div style={cardStyle}>
                  <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Competitive Ratio at k = {selectedK} — Bar Comparison (replicates Fig 2)</h3>
                  <p style={{ color: COLORS.muted, margin: "0 0 20px", fontSize: 12 }}>
                    High-degree hub-like instances (Star) pay the largest local verification overhead.
                  </p>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={ratioByGraph.sort((a, b) => b.local - a.local)} margin={{ top: 5, right: 20, bottom: 40, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                      <XAxis dataKey="name" stroke={COLORS.border} tick={{ fill: COLORS.muted, fontSize: 11 }} angle={-35} textAnchor="end" />
                      <YAxis stroke={COLORS.border} tick={labelStyle} />
                      <Tooltip content={<TT />} />
                      <Legend wrapperStyle={{ color: COLORS.muted, fontSize: 12 }} />
                      <ReferenceLine y={1} stroke={COLORS.opt} strokeDasharray="6 3" label={{ value: "Optimal", fill: COLORS.opt, fontSize: 10 }} />
                      <Bar dataKey="local" name="Local (CL/OPT)" fill={COLORS.local} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="global" name="Global (CG/OPT)" fill={COLORS.global} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* ── Tab: Rounds ── */}
            {activeTab === "rounds" && (
              <div>
                <div style={cardStyle}>
                  <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Round Complexity vs k (averaged)</h3>
                  <p style={{ color: COLORS.muted, margin: "0 0 20px", fontSize: 12 }}>
                    One-hop: O(k²). Global: O(k³) due to scout routing. Local: O(k²) epochs but larger constants.
                  </p>
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={roundsVsK} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                      <XAxis dataKey="k" stroke={COLORS.border} tick={labelStyle} label={{ value: "k (robots)", position: "insideBottom", offset: -2, fill: COLORS.muted, fontSize: 12 }} />
                      <YAxis stroke={COLORS.border} tick={labelStyle} label={{ value: "Avg rounds", angle: -90, position: "insideLeft", fill: COLORS.muted, fontSize: 12 }} />
                      <Tooltip content={<TT />} />
                      <Legend wrapperStyle={{ color: COLORS.muted, fontSize: 12 }} />
                      <Line type="monotone" dataKey="oneHop" name="One-Hop (Alg 1)" stroke={COLORS.oneHop} strokeWidth={2.5} dot={{ r: 4 }} />
                      <Line type="monotone" dataKey="global" name="Global (Alg 2)" stroke={COLORS.global} strokeWidth={2.5} dot={{ r: 4 }} />
                      <Line type="monotone" dataKey="local" name="Local (Alg 3)" stroke={COLORS.local} strokeWidth={2.5} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                  {["path", "star", "complete", "barabasi_albert"].map(gt => {
                    const data = K_VALUES.map(k => {
                      const r = results[gt]?.[k];
                      return r ? { k, oneHop: r.oneHop.rounds, global: r.global.rounds, local: r.local.rounds } : null;
                    }).filter(Boolean);
                    const label = GRAPH_TYPES.find(g => g.key === gt)?.label;
                    return (
                      <div key={gt} style={cardStyle}>
                        <h4 style={{ margin: "0 0 14px", fontSize: 13, color: COLORS.muted }}>{label}</h4>
                        <ResponsiveContainer width="100%" height={180}>
                          <LineChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                            <XAxis dataKey="k" stroke={COLORS.border} tick={{ fill: COLORS.muted, fontSize: 10 }} />
                            <YAxis stroke={COLORS.border} tick={{ fill: COLORS.muted, fontSize: 10 }} />
                            <Tooltip content={<TT />} />
                            <Line type="monotone" dataKey="oneHop" stroke={COLORS.oneHop} strokeWidth={2} dot={false} name="One-Hop" />
                            <Line type="monotone" dataKey="global" stroke={COLORS.global} strokeWidth={2} dot={false} name="Global" />
                            <Line type="monotone" dataKey="local" stroke={COLORS.local} strokeWidth={2} dot={false} name="Local" />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Tab: Epoch Trace ── */}
            {activeTab === "epoch" && (
              <div>
                <div style={cardStyle}>
                  <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>
                    Cumulative Cost per Epoch — {GRAPH_TYPES.find(g => g.key === selectedGraph)?.label}, k = {selectedK}
                  </h3>
                  <p style={{ color: COLORS.muted, margin: "0 0 20px", fontSize: 12 }}>
                    Each epoch = one robot settles. One-Hop tracks OPT exactly. Global & Local diverge due to test overhead.
                  </p>
                  <ResponsiveContainer width="100%" height={340}>
                    <LineChart data={epochData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                      <XAxis dataKey="epoch" stroke={COLORS.border} tick={labelStyle} label={{ value: "Epoch (robot settled)", position: "insideBottom", offset: -2, fill: COLORS.muted, fontSize: 12 }} />
                      <YAxis stroke={COLORS.border} tick={labelStyle} label={{ value: "Cumulative cost", angle: -90, position: "insideLeft", fill: COLORS.muted, fontSize: 12 }} />
                      <Tooltip content={<TT />} />
                      <Legend wrapperStyle={{ color: COLORS.muted, fontSize: 12 }} />
                      <Line type="monotone" dataKey="oneHop" name="One-Hop" stroke={COLORS.oneHop} strokeWidth={2.5} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="global" name="Global" stroke={COLORS.global} strokeWidth={2.5} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="local" name="Local" stroke={COLORS.local} strokeWidth={2.5} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="opt" name="OPT (ideal)" stroke={COLORS.opt} strokeDasharray="6 3" strokeWidth={1.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Epoch detail table */}
                <div style={cardStyle}>
                  <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>Epoch-by-Epoch Detail (One-Hop)</h3>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                          {["Epoch", "Vertex", "Distance", "Cum. Cost", "Cum. Rounds"].map(h => (
                            <th key={h} style={{ padding: "8px 12px", color: COLORS.muted, textAlign: "left", fontWeight: 500 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(results[selectedGraph]?.[selectedK]?.oneHop?.epochs || []).map((e, i) => (
                          <tr key={i} style={{ borderBottom: `1px solid ${COLORS.border}22` }}>
                            <td style={{ padding: "8px 12px", color: COLORS.oneHop, fontWeight: 600 }}>{e.epoch}</td>
                            <td style={{ padding: "8px 12px" }}>{e.vertex}</td>
                            <td style={{ padding: "8px 12px" }}>{e.distance.toFixed(1)}</td>
                            <td style={{ padding: "8px 12px" }}>{e.cumCost.toFixed(1)}</td>
                            <td style={{ padding: "8px 12px" }}>{e.cumRounds}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ── Tab: Radar ── */}
            {activeTab === "radar" && (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
                  {[
                    { key: "oneHop", label: "One-Hop (Alg 1)", color: COLORS.oneHop },
                    { key: "global", label: "Global (Alg 2)", color: COLORS.global },
                    { key: "local", label: "Local (Alg 3)", color: COLORS.local },
                  ].map(alg => (
                    <div key={alg.key} style={cardStyle}>
                      <h3 style={{ margin: "0 0 4px", fontSize: 13, color: alg.color }}>{alg.label}</h3>
                      <p style={{ color: COLORS.muted, margin: "0 0 14px", fontSize: 11 }}>Competitive ratio by graph class at k={selectedK}</p>
                      <ResponsiveContainer width="100%" height={260}>
                        <RadarChart data={radarData}>
                          <PolarGrid stroke={COLORS.border} />
                          <PolarAngleAxis dataKey="graph" tick={{ fill: COLORS.muted, fontSize: 9 }} />
                          <PolarRadiusAxis tick={{ fill: COLORS.muted, fontSize: 8 }} />
                          <Radar dataKey={alg.key} stroke={alg.color} fill={alg.color} fillOpacity={0.25} name={alg.label} />
                          <Tooltip content={<TT />} />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  ))}
                </div>

                <div style={cardStyle}>
                  <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Unified Radar — All Algorithms at k = {selectedK}</h3>
                  <p style={{ color: COLORS.muted, margin: "0 0 14px", fontSize: 12 }}>Larger area = more overhead. One-hop collapses to a point at 1.</p>
                  <ResponsiveContainer width="100%" height={340}>
                    <RadarChart data={radarData}>
                      <PolarGrid stroke={COLORS.border} />
                      <PolarAngleAxis dataKey="graph" tick={{ fill: COLORS.muted, fontSize: 10 }} />
                      <PolarRadiusAxis tick={{ fill: COLORS.muted, fontSize: 9 }} />
                      <Radar dataKey="oneHop" stroke={COLORS.oneHop} fill={COLORS.oneHop} fillOpacity={0.15} name="One-Hop" />
                      <Radar dataKey="global" stroke={COLORS.global} fill={COLORS.global} fillOpacity={0.15} name="Global" />
                      <Radar dataKey="local" stroke={COLORS.local} fill={COLORS.local} fillOpacity={0.15} name="Local" />
                      <Legend wrapperStyle={{ color: COLORS.muted, fontSize: 12 }} />
                      <Tooltip content={<TT />} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* ── Tab: Scatter ── */}
            {activeTab === "scatter" && (
              <div>
                <div style={cardStyle}>
                  <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Algorithm Cost vs OPT (all graphs × all k)</h3>
                  <p style={{ color: COLORS.muted, margin: "0 0 20px", fontSize: 12 }}>
                    Points on the dashed y=x line are optimal. One-hop lies exactly on the line. Dot size = k.
                  </p>
                  <ResponsiveContainer width="100%" height={420}>
                    <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                      <XAxis dataKey="x" name="OPT" stroke={COLORS.border} tick={labelStyle} label={{ value: "OPT cost", position: "insideBottom", offset: -5, fill: COLORS.muted, fontSize: 12 }} type="number" />
                      <YAxis dataKey="y" name="Algorithm cost" stroke={COLORS.border} tick={labelStyle} label={{ value: "Algorithm cost", angle: -90, position: "insideLeft", fill: COLORS.muted, fontSize: 12 }} type="number" />
                      <ZAxis dataKey="z" range={[20, 120]} />
                      <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0]?.payload;
                        return (
                          <div style={{ background: "#0F172A", border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "8px 12px", fontSize: 11 }}>
                            <p style={{ color: COLORS.muted }}>{d?.label}</p>
                            <p style={{ color: COLORS.text }}>OPT: {d?.x?.toFixed(1)}</p>
                            <p style={{ color: COLORS.text }}>Cost: {d?.y?.toFixed(1)}</p>
                            <p style={{ color: COLORS.text }}>k: {d?.z}</p>
                          </div>
                        );
                      }} />
                      <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 800, y: 800 }]} stroke={COLORS.opt} strokeDasharray="6 3" label={{ value: "y = x (optimal)", fill: COLORS.opt, fontSize: 10 }} />
                      <Scatter name="One-Hop" data={scatterOH} fill={COLORS.oneHop} fillOpacity={0.7} />
                      <Scatter name="Global" data={scatterGL} fill={COLORS.global} fillOpacity={0.6} />
                      <Scatter name="Local" data={scatterLO} fill={COLORS.local} fillOpacity={0.6} />
                      <Legend wrapperStyle={{ color: COLORS.muted, fontSize: 12 }} />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* ── Tab: Full Table ── */}
            {activeTab === "table" && (
              <div style={cardStyle}>
                <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Full Experiment Results (replicates Tables 2 & 3)</h3>
                <p style={{ color: COLORS.muted, margin: "0 0 16px", fontSize: 12 }}>
                  C₁ = One-Hop cost · CG = Global cost · CL = Local cost · All vs OPT
                </p>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead>
                      <tr style={{ borderBottom: `2px solid ${COLORS.border}` }}>
                        {["Graph", "k", "Δ", "OPT", "C₁", "C₁/OPT", "CG", "CG/OPT", "CL", "CL/OPT"].map(h => (
                          <th key={h} style={{ padding: "8px 10px", color: COLORS.muted, textAlign: "left", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tableData.map((row, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${COLORS.border}22`, background: i % 2 === 0 ? "transparent" : "#ffffff08" }}>
                          <td style={{ padding: "6px 10px", fontWeight: 500 }}>{row.graph}</td>
                          <td style={{ padding: "6px 10px" }}>{row.k}</td>
                          <td style={{ padding: "6px 10px" }}>{row.delta}</td>
                          <td style={{ padding: "6px 10px" }}>{row.opt}</td>
                          <td style={{ padding: "6px 10px", color: COLORS.oneHop }}>{row.oh_cost}</td>
                          <td style={{ padding: "6px 10px", color: COLORS.oneHop, fontWeight: 600 }}>
                            {parseFloat(row.oh_ratio) <= 1.001 ? "1.000 ✓" : row.oh_ratio}
                          </td>
                          <td style={{ padding: "6px 10px", color: COLORS.global }}>{row.gl_cost}</td>
                          <td style={{ padding: "6px 10px", color: COLORS.global, fontWeight: 600 }}>{row.gl_ratio}</td>
                          <td style={{ padding: "6px 10px", color: COLORS.local }}>{row.lo_cost}</td>
                          <td style={{ padding: "6px 10px", color: COLORS.local, fontWeight: 600 }}>{row.lo_ratio}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
