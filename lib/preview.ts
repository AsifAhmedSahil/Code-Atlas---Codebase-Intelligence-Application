import previewData from "@/data/preview-analysis.json";
import { assertParseResult } from "@/lib/parser/io";
import type { ParseResult } from "@/lib/parser/types";

// The preview renders a checked-in parse of a real repository (msw, a few
// hundred files with real nesting) so the canvas interface can be built and
// inspected with no account, database or network. Validating the imported file
// makes a contract drift a build-time failure instead of an odd-looking screen.
// This scaffolding goes away once analyses are stored properly.
assertParseResult(previewData);
const preview = previewData;

export function getPreviewParse(): ParseResult {
  return preview;
}