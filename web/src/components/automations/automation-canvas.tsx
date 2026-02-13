"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactFlow, {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  MiniMap,
} from "reactflow";
import type {
  Node,
  Edge,
  NodeChange,
  EdgeChange,
  Connection,
  ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "~/components/ui/dropdown-menu";
// DropdownMenu intentionally not used in this file (context menus use ContextMenu)

import {
  getNodeRegistryItem,
  type AutomationNodeType,
} from "~/lib/automations/node-registry";
import NodeConfigPanel, {
  type EditorNodeData,
} from "~/components/automations/node-config-panel";

export type CanvasState = { nodes: Node<EditorNodeData>[]; edges: Edge[] };
export type AutomationCanvasHandle = {
  createNode: (type: AutomationNodeType) => void;
};

type AutomationCanvasProps = {
  value?: CanvasState;
  onChange?: (v: CanvasState) => void;
};

const AutomationCanvas = React.forwardRef<
  AutomationCanvasHandle,
  AutomationCanvasProps
>(function AutomationCanvas({ value, onChange }, ref) {
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [nodes, setNodes] = useState<Node<EditorNodeData>[]>(value?.nodes ?? []);
  const [edges, setEdges] = useState<Edge[]>(value?.edges ?? []);
  const [context, setContext] = useState<{ x: number; y: number } | null>(null);
  const [nodeContext, setNodeContext] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isSyncingFromProp = useRef(false);
  const lastEmittedRef = useRef<CanvasState | null>(null);

  const isSameState = (
    a: CanvasState | undefined,
    b: CanvasState | undefined,
  ) => {
    if (!a || !b) return false;
    const aNodes = a.nodes ?? [];
    const bNodes = b.nodes ?? [];
    const aEdges = a.edges ?? [];
    const bEdges = b.edges ?? [];
    if (aNodes.length !== bNodes.length) return false;
    if (aEdges.length !== bEdges.length) return false;
    for (let i = 0; i < aNodes.length; i++) {
      const an = aNodes[i] as Node<EditorNodeData>;
      const bn = bNodes[i] as Node<EditorNodeData>;
      if (an.id !== bn.id) return false;
      if (
        an.position?.x !== bn.position?.x ||
        an.position?.y !== bn.position?.y
      )
        return false;
      if (
        an.data?.label !== bn.data?.label ||
        an.data?.nodeType !== bn.data?.nodeType
      )
        return false;
    }
    for (let i = 0; i < aEdges.length; i++) {
      const ae = aEdges[i] as Edge;
      const be = bEdges[i] as Edge;
      if (ae.id !== be.id) return false;
      if (ae.source !== be.source || ae.target !== be.target) return false;
    }
    return true;
  };

  useEffect(() => {
    if (!value) return;
    // guard against unnecessary updates and loops
    if (isSameState({ nodes, edges }, value)) return;
    isSyncingFromProp.current = true;
    setNodes(value.nodes ?? []);
    setEdges(value.edges ?? []);
    // allow microtask tick for setState to flush, then unset
    setTimeout(() => {
      isSyncingFromProp.current = false;
    }, 0);
    // record last emitted to prevent emitting the same state back
    lastEmittedRef.current = value;
  }, [value]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) =>
      setNodes((nodes) => applyNodeChanges(changes, nodes)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) =>
      setEdges((edges) => applyEdgeChanges(changes, edges)),
    [],
  );
  const onConnect = useCallback(
    (connection: Connection) => setEdges((edges) => addEdge(connection, edges)),
    [],
  );

  useEffect(() => {
    if (isSyncingFromProp.current) return;
    const current = { nodes, edges } as CanvasState;
    // if value equals current, then skip emitting
    if (isSameState(value, current)) return;
    // if already emitted this state, skip emitting again
    if (isSameState(lastEmittedRef.current ?? undefined, current)) return;
    onChange?.(current);
    lastEmittedRef.current = current;
  }, [nodes, edges, onChange, value]);

  const createNodeAt = (x: number, y: number, type: AutomationNodeType) => {
    const id = `${type}-${Date.now()}`;
    const registryItem = getNodeRegistryItem(type);

    const newNode: Node<EditorNodeData> = {
      id,
      position: rfInstance ? rfInstance.project({ x, y }) : { x, y },
      data: {
        nodeType: type,
        label: registryItem.label,
        params: { ...(registryItem.defaultParams as any) },
      },
      style: { padding: 12 },
    };

    setNodes((ns) => ns.concat(newNode));
    setSelectedNodeId(id);
    return newNode;
  };

  React.useImperativeHandle(ref, () => ({
    createNode: (type: AutomationNodeType) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = rect.width / 2;
      const y = rect.height / 2;
      createNodeAt(x, y, type);
    },
  }));

  const onCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setNodeContext(null);
    setContext({ x: e.clientX, y: e.clientY });
  }, []);

  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    setContext(null);
    setNodeContext({ id: node.id, x: e.clientX, y: e.clientY });
  }, []);

  const addActionNode = (type: AutomationNodeType) => {
    if (!context || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = context.x - rect.left;
    const y = context.y - rect.top;
    createNodeAt(x, y, type);
    setContext(null);
  };

  const editNode = (id: string) => {
    setSelectedNodeId(id);
    setNodeContext(null);
  };
  const deleteNode = (id: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    setNodeContext(null);
  };

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const data = event.dataTransfer.getData("text/plain");
      if (!data || !containerRef.current) return;
      try {
        const item = JSON.parse(data) as {
          id: string;
          label: string;
          type: AutomationNodeType;
        };
        const rect = containerRef.current.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        createNodeAt(x, y, item.type);
      } catch (err) {
        // ignore
      }
    },
    [createNodeAt],
  );
  const selected = selectedNodeId
    ? nodes.find((n) => n.id === selectedNodeId) ?? null
    : null;

  return (
    <div className="flex rounded-lg border bg-popover" ref={containerRef}>
      <div
        className="flex-1 p-2"
        onContextMenu={onCanvasContextMenu}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <div className="h-[80vh] w-full">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onPaneContextMenu={(e) => onCanvasContextMenu(e as any)}
            onInit={setRfInstance}
            onNodeContextMenu={onNodeContextMenu as any}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            fitView
          >
            <Background gap={12} color="#2a2a2a" />
            <MiniMap />
            <Controls />
          </ReactFlow>
        </div>

        <NodeConfigPanel
          selected={
            selected
              ? { id: selected.id, data: selected.data as EditorNodeData }
              : null
          }
          onClose={() => setSelectedNodeId(null)}
          onUpdateLabel={(nodeId, nextLabel) => {
            setNodes((ns) =>
              ns.map((n) =>
                n.id === nodeId
                  ? { ...n, data: { ...(n.data as any), label: nextLabel } }
                  : n,
              ),
            );
          }}
          onUpdateParams={(nodeId, nextParams) => {
            setNodes((ns) =>
              ns.map((n) =>
                n.id === nodeId
                  ? { ...n, data: { ...(n.data as any), params: nextParams } }
                  : n,
              ),
            );
          }}
        />
      </div>

      <DropdownMenu
        open={!!context}
        onOpenChange={(v) => !v && setContext(null)}
      >
        <DropdownMenuTrigger asChild>
          <div />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="min-w-[14rem]"
          style={
            context
              ? { left: context.x, top: context.y, position: "fixed" }
              : undefined
          }
        >
          <DropdownMenuItem onSelect={() => addActionNode("manualTrigger")}>
            Add Manual Trigger
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => addActionNode("webhookTrigger")}>
            Add Webhook Trigger
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => addActionNode("set")}>
            Add Set
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => addActionNode("if")}>
            Add If
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => addActionNode("merge")}>
            Add Merge
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => addActionNode("log")}>
            Add Log
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu
        open={!!nodeContext}
        onOpenChange={(v) => !v && setNodeContext(null)}
      >
        <DropdownMenuTrigger asChild>
          <div />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="min-w-[10rem]"
          style={
            nodeContext
              ? { left: nodeContext.x, top: nodeContext.y, position: "fixed" }
              : undefined
          }
        >
          <DropdownMenuItem
            onSelect={() => nodeContext && editNode(nodeContext.id)}
          >
            Edit Node
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => nodeContext && deleteNode(nodeContext.id)}
          >
            Delete Node
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => nodeContext && setNodeContext(null)}
          >
            Change Automation Type
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="mt-2 flex justify-end gap-2">
        <Button onClick={() => onChange?.({ nodes, edges })}>Save</Button>
      </div>
    </div>
  );
});

export default AutomationCanvas;
