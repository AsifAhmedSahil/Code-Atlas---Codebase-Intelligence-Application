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
  useCallback,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import type { ExplanationResult } from "@/lib/ai/subject";
import type { FoldedMap, MapNode } from "@/lib/map/fold";
import type { ParsedFile, ParseResult } from "@/lib/parser/types";

export type Selection =
  | { kind: "node"; id: string }
  | { kind: "file"; path: string }
  | null;

export type Hover =
  | { kind: "node"; id: string }
  | { kind: "file"; path: string }
  | null;

export interface WorkspaceValue {
  // The analysis this map came from, so an explanation can name the subject it
  // belongs to when it asks the server.
  analysisId: string;
  parse: ParseResult;
  folded: FoldedMap;
  labels: Record<string, string>;
  fileByPath: Map<string, ParsedFile>;
  // Each file's role, as the parser assigned it. The rail filters on this and
  // the map dims by it, so both agree on what a "controller" or a "page route"
  // is without either re-deriving it.
  roleByPath: Map<string, string>;
  nodeById: Map<string, MapNode>;
  selection: Selection;
  setSelection: Dispatch<SetStateAction<Selection>>;
  hover: Hover;
  setHover: Dispatch<SetStateAction<Hover>>;
  // The role the rail has focused. Nothing outside it disappears — it just
  // dims — so the shape of the repository stays on screen while one role stands
  // out. Null means no category, dim nothing.
  category: string | null;
  setCategory: Dispatch<SetStateAction<string | null>>;
  // Explanations already fetched this session, by subject. Held here, above the
  // pane, so changing the tab or the selection never throws one away.
  explanations: ReadonlyMap<string, ExplanationResult>;
  setExplanation: (key: string, result: ExplanationResult) => void;
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
  analysisId,
  parse,
  folded,
  labels,
  children,
}: {
  analysisId: string;
  parse: ParseResult;
  folded: FoldedMap;
  labels: Record<string, string>;
  children: ReactNode;
}) {
  const [selection, setSelection] = useState<Selection>(null);
  const [hover, setHover] = useState<Hover>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [explanations, setExplanations] = useState<ReadonlyMap<string, ExplanationResult>>(
    () => new Map(),
  );

  const setExplanation = useCallback((key: string, result: ExplanationResult) => {
    setExplanations((current) => {
      const next = new Map(current);
      next.set(key, result);
      return next;
    });
  }, []);

  const fileByPath = useMemo(
    () => new Map(parse.files.map((file) => [file.path, file])),
    [parse],
  );
  const roleByPath = useMemo(
    () => new Map(parse.roles.map((entry) => [entry.path, entry.role])),
    [parse],
  );
  const nodeById = useMemo(
    () => new Map(folded.nodes.map((node) => [node.id, node])),
    [folded],
  );

  const value = useMemo<WorkspaceValue>(
    () => ({
      analysisId,
      parse,
      folded,
      labels,
      fileByPath,
      roleByPath,
      nodeById,
      selection,
      setSelection,
      hover,
      setHover,
      category,
      setCategory,
      explanations,
      setExplanation,
    }),
    [
      analysisId,
      parse,
      folded,
      labels,
      fileByPath,
      roleByPath,
      nodeById,
      selection,
      hover,
      category,
      explanations,
      setExplanation,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
  );
}
