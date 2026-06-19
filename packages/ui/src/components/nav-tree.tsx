import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * A left-rail navigator tree with live per-node error/warn badges — the release
 * editor's model explorer (a 400-line model stays navigable; the author jumps
 * straight to the broken slot). Domain-agnostic: it renders whatever node tree
 * it is handed.
 */
export interface NavTreeNode {
  id: string;
  label: React.ReactNode;
  errorCount?: number;
  warnCount?: number;
  children?: NavTreeNode[];
}

export interface NavTreeProps {
  nodes: readonly NavTreeNode[];
  selectedId?: string;
  onSelect: (id: string) => void;
  className?: string;
}

function CountBadge({ count, tone }: { count: number; tone: "error" | "warn" }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none",
        tone === "error"
          ? "bg-destructive/15 text-destructive"
          : "bg-amber-500/15 text-amber-600 dark:text-amber-500",
      )}
    >
      {count}
    </span>
  );
}

function NavNode({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: NavTreeNode;
  depth: number;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const selected = node.id === selectedId;
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(node.id)}
        style={{ paddingLeft: `${depth * 0.75 + 0.5}rem` }}
        className={cn(
          "flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm",
          selected ? "bg-accent text-accent-foreground font-medium" : "hover:bg-accent/50",
        )}
      >
        <span className="truncate">{node.label}</span>
        {node.errorCount ? (
          <CountBadge count={node.errorCount} tone="error" />
        ) : (
          <CountBadge count={node.warnCount ?? 0} tone="warn" />
        )}
      </button>
      {node.children && node.children.length > 0 ? (
        <ul>
          {node.children.map((child) => (
            <NavNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function NavTree({ nodes, selectedId, onSelect, className }: NavTreeProps) {
  return (
    <nav className={className} data-slot="nav-tree">
      <ul>
        {nodes.map((node) => (
          <NavNode
            key={node.id}
            node={node}
            depth={0}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </nav>
  );
}
