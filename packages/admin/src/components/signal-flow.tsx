import { useCallback, useEffect, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type NodeProps,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ConnectedNode, SignalEvent } from "@/lib/api";

// ── Desert node ──────────────────────────────────────────────────────────────

interface DesertNodeData {
  nodeId: string;
  projects: string[];
  isActive: boolean;
  [key: string]: unknown;
}

function DesertNode({ data, selected }: NodeProps) {
  const d = data as DesertNodeData;
  return (
    <div
      style={{
        background: "oklch(0.16 0.025 65)",
        border: `1px solid ${d.isActive ? "oklch(0.72 0.16 55)" : "oklch(0.28 0.04 65)"}`,
        borderRadius: "0.25rem",
        padding: "10px 14px",
        minWidth: 120,
        boxShadow: d.isActive
          ? "0 0 16px oklch(0.72 0.16 55 / 0.35)"
          : selected
            ? "0 0 12px oklch(0.72 0.16 55 / 0.2)"
            : "none",
        transition: "border-color 0.4s, box-shadow 0.4s",
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: "oklch(0.72 0.16 55)", border: "none", width: 6, height: 6 }}
      />
      <div
        style={{
          fontFamily: "Space Grotesk, sans-serif",
          fontSize: "0.7rem",
          fontWeight: 700,
          color: d.isActive ? "oklch(0.82 0.18 55)" : "oklch(0.82 0.04 70)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {d.nodeId}
      </div>
      <div
        style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: "0.6rem",
          color: "oklch(0.55 0.03 65)",
          marginTop: 2,
        }}
      >
        {d.projects.join(", ")}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: "oklch(0.72 0.16 55)", border: "none", width: 6, height: 6 }}
      />
    </div>
  );
}

const nodeTypes = { desertNode: DesertNode };

// ── Layout ───────────────────────────────────────────────────────────────────

function circularLayout(connectedNodes: ConnectedNode[]): Node[] {
  const n = connectedNodes.length;
  if (n === 0) return [];
  const cx = 400;
  const cy = 180;
  const r = Math.max(130, n * 65);
  return connectedNodes.map((node, i) => ({
    id: node.nodeId,
    type: "desertNode",
    position: {
      x: cx + r * Math.cos((2 * Math.PI * i) / n - Math.PI / 2) - 60,
      y: cy + r * Math.sin((2 * Math.PI * i) / n - Math.PI / 2) - 25,
    },
    data: {
      nodeId: node.nodeId,
      projects: node.projects,
      isActive: false,
    },
  }));
}

function deriveEdges(
  signals: SignalEvent[],
  connectedNodes: ConnectedNode[],
  selectedNode: string | null,
): Edge[] {
  const now = Date.now();
  const nodeIds = new Set(connectedNodes.map((n) => n.nodeId));

  // Deduplicate: keep most-recent signal per from→to pair
  const seen = new Map<string, SignalEvent>();
  for (const s of signals) {
    const key = `${s.from}:${s.to}`;
    if (!seen.has(key)) seen.set(key, s);
  }

  const edges: Edge[] = [];
  for (const [, s] of seen) {
    const age = now - new Date(s.timestamp).getTime();
    if (age > 30_000) continue;

    const isRecent = age < 10_000;
    const opacity = isRecent ? 1 : Math.max(0, 1 - (age - 10_000) / 20_000);
    const color = isRecent ? "oklch(0.72 0.16 55)" : "oklch(0.55 0.03 65)";

    const makeEdge = (from: string, to: string): Edge => ({
      id: `${from}:${to}`,
      source: from,
      target: to,
      animated: isRecent,
      style: { stroke: color, strokeOpacity: opacity, strokeWidth: 1.5 },
      label: s.type,
      labelStyle: {
        fill: "oklch(0.55 0.03 65)",
        fontSize: 9,
        fontFamily: "JetBrains Mono, monospace",
      },
      labelBgStyle: { fill: "oklch(0.16 0.025 65)", fillOpacity: 0.85 },
      data: { type: s.type, content: s.content },
    });

    if (s.to === "") {
      for (const node of connectedNodes) {
        if (node.nodeId !== s.from && nodeIds.has(node.nodeId)) {
          edges.push(makeEdge(s.from, node.nodeId));
        }
      }
    } else if (nodeIds.has(s.from) && nodeIds.has(s.to)) {
      edges.push(makeEdge(s.from, s.to));
    }
  }

  if (selectedNode) {
    return edges.filter(
      (e) => e.source === selectedNode || e.target === selectedNode,
    );
  }
  return edges;
}

// ── Component ────────────────────────────────────────────────────────────────

interface SignalFlowProps {
  connectedNodes: ConnectedNode[];
  signals: SignalEvent[];
  isAuthed: boolean;
}

export function SignalFlow({ connectedNodes, signals, isAuthed }: SignalFlowProps) {
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  useEffect(() => {
    const now = Date.now();
    const activeNodes = new Set(
      signals
        .filter((s) => now - new Date(s.timestamp).getTime() < 10_000)
        .flatMap((s) => [s.from, s.to].filter(Boolean)),
    );

    setRfNodes(
      circularLayout(connectedNodes).map((n) => ({
        ...n,
        data: {
          ...n.data,
          isActive: activeNodes.has(n.id),
        },
      })),
    );
  }, [connectedNodes, signals]);

  useEffect(() => {
    setRfEdges(deriveEdges(signals, connectedNodes, selectedNode));
  }, [signals, connectedNodes, selectedNode]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedNode((prev) => (prev === node.id ? null : node.id));
    },
    [],
  );

  if (!isAuthed) return null;

  return (
    <section className="mb-10">
      <div className="mb-5 border-b border-sand-dim pb-2 text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-accent">
        Signal Flow
      </div>

      {connectedNodes.length === 0 ? (
        <div
          style={{
            height: 220,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "oklch(0.16 0.025 65)",
            borderRadius: "0.25rem",
            color: "oklch(0.55 0.03 65)",
            fontFamily: "Space Grotesk, sans-serif",
            fontSize: "0.75rem",
            letterSpacing: "0.1em",
          }}
        >
          No nodes in the spice network.
        </div>
      ) : (
        <div style={{ height: 400, borderRadius: "0.25rem", overflow: "hidden" }}>
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            proOptions={{ hideAttribution: true }}
            style={{ background: "oklch(0.13 0.02 65)" }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1}
              color="oklch(0.28 0.04 65)"
            />
          </ReactFlow>
        </div>
      )}
    </section>
  );
}
