"use client";

// The map and the detail pane are two views of one selection, so that selection
// (and the transient hover) lives above both of them rather than inside the
// canvas. Everything here is already in the browser: selecting fires no request,
// it just changes this state.
//
// The provider takes the parse, the folded map and the labels as props and
// derives the lookups once. Consumers read a single value; nothing fetches.

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import type { FoldedMap, MapNode } from "@/lib/map/fold";
import type { ParsedFile, ParseResult } from "@/lib/parser/types";

import type { FileKind } from "./categories";

export type Selection =
  | { kind: "node"; id: string }
  | { kind: "file"; path: string }
  | null;

export type Hover =
  | { kind: "node"; id: string }
  | { kind: "file"; path: string }
  | null;

export interface WorkspaceValue {
  parse: ParseResult;
  folded: FoldedMap;
  labels: Record<string, string>;
  fileByPath: Map<string, ParsedFile>;
  nodeById: Map<string, MapNode>;
  selection: Selection;
  setSelection: Dispatch<SetStateAction<Selection>>;
  hover: Hover;
  setHover: Dispatch<SetStateAction<Hover>>;
  // The file kind the rail has focused. Nothing outside it disappears — it just
  // dims — so the shape of the repository stays on screen while one kind stands
  // out. Null means no category, dim nothing.
  category: FileKind | null;
  setCategory: Dispatch<SetStateAction<FileKind | null>>;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error("useWorkspace must be used inside WorkspaceProvider");
  }
  return value;
}

export function WorkspaceProvider({
  parse,
  folded,
  labels,
  children,
}: {
  parse: ParseResult;
  folded: FoldedMap;
  labels: Record<string, string>;
  children: ReactNode;
}) {
  const [selection, setSelection] = useState<Selection>(null);
  const [hover, setHover] = useState<Hover>(null);
  const [category, setCategory] = useState<FileKind | null>(null);

  const fileByPath = useMemo(
    () => new Map(parse.files.map((file) => [file.path, file])),
    [parse],
  );
  const nodeById = useMemo(
    () => new Map(folded.nodes.map((node) => [node.id, node])),
    [folded],
  );

  const value = useMemo<WorkspaceValue>(
    () => ({
      parse,
      folded,
      labels,
      fileByPath,
      nodeById,
      selection,
      setSelection,
      hover,
      setHover,
      category,
      setCategory,
    }),
    [parse, folded, labels, fileByPath, nodeById, selection, hover, category],
  );

  return (
    <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
  );
}
