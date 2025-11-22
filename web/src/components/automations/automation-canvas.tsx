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

export type AutomationNodeData = {
  label: string;
  type: "action" | "trigger" | "condition";
};
export type CanvasState = { nodes: Node<AutomationNodeData>[]; edges: Edge[] };
export type AutomationCanvasHandle = {
  createNode: (type: AutomationNodeData["type"]) => void;
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
  const [nodes, setNodes] = useState<Node<AutomationNodeData>[]>(
    value?.nodes ?? [],
  );
  const [edges, setEdges] = useState<Edge[]>(value?.edges ?? []);
  const [context, setContext] = useState<{ x: number; y: number } | null>(null);
  const [nodeContext, setNodeContext] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
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
      const an = aNodes[i] as Node<AutomationNodeData>;
      const bn = bNodes[i] as Node<AutomationNodeData>;
      if (an.id !== bn.id) return false;
      if (
        an.position?.x !== bn.position?.x ||
        an.position?.y !== bn.position?.y
      )
        return false;
      if (an.data?.label !== bn.data?.label || an.data?.type !== bn.data?.type)
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

  const createNodeAt = (
    x: number,
    y: number,
    type: AutomationNodeData["type"],
  ) => {
    const id = `${type}-${Date.now()}`;
    const newNode: Node<AutomationNodeData> = {
      id,
      position: rfInstance ? rfInstance.project({ x, y }) : { x, y },
      data: {
        label: `${type.charAt(0).toUpperCase() + type.slice(1)} node`,
        type,
      },
      style: { padding: 12 },
    };
    setNodes((ns) => ns.concat(newNode));
    return newNode;
  };

  React.useImperativeHandle(ref, () => ({
    createNode: (type: AutomationNodeData["type"]) => {
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

  const addActionNode = (type: AutomationNodeData["type"]) => {
    if (!context || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = context.x - rect.left;
    const y = context.y - rect.top;
    createNodeAt(x, y, type);
    setContext(null);
  };

  const editNode = (id: string) => {
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
          type: "trigger" | "action" | "condition";
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
  return (
    <div
      className="bg-popover rounded-lg border p-2"
      ref={containerRef}
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
          fitView
        >
          <Background gap={12} color="#2a2a2a" />
          <MiniMap />
          <Controls />
        </ReactFlow>
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
          className="min-w-[10rem]"
          style={
            context
              ? { left: context.x, top: context.y, position: "fixed" }
              : undefined
          }
        >
          <DropdownMenuItem onSelect={() => addActionNode("action")}>
            Add Node
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => addActionNode("trigger")}>
            Add Trigger
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => addActionNode("condition")}>
            Add Condition
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
