// Temporary acceptance check for the folding model. Reads a checked-in parse
// and reports how the map comes out. Not part of the shipped app.
import { readFileSync } from "node:fs";
import { assertParseResult } from "../lib/parser/io";
import { foldMap } from "../lib/map/fold";
import { resolveNodeLabels } from "../lib/map/labels";

const path = process.argv[2] ?? "data/preview-analysis.json";
const data = JSON.parse(readFileSync(path, "utf8"));
assertParseResult(data);

const map = foldMap(data);
const labels = resolveNodeLabels(map.nodes, data.root);

console.log(`repo: ${data.root}`);
console.log(`threshold: ${map.threshold} of ${map.nodes.length} nodes (target <= 22)`);
console.log(`nodes: ${map.nodes.length}, edges: ${map.edges.length}, internal (hidden): ${map.internalEdges}`);

const minusOne = map.nodes.filter((n) => n.files.length <= 1);
console.log(`nodes with <=1 file: ${minusOne.map((n) => `${n.id}(${n.files.length})`).join(", ") || "none"}`);
console.log(`total files in nodes: ${map.nodes.reduce((s, n) => s + n.files.length, 0)} / ${data.files.length}`);

const nodeIds = new Set(map.nodes.map((n) => n.id));
const dangling = map.edges.filter((e) => !nodeIds.has(e.source) || !nodeIds.has(e.target));
console.log(`edges onto missing nodes: ${dangling.length}`);

map.nodes.sort((a, b) => b.fanIn - a.fanIn);
console.log("largest fan-in nodes:");
for (const n of map.nodes.slice(0, 8)) {
  console.log(`  ${labels.get(n.id)!.padEnd(18)} fanIn ${String(n.fanIn).padStart(3)} fanOut ${String(n.fanOut).padStart(3)} files ${String(n.files.length).padStart(3)}`);
}

console.log("\npanel rows cap (files beyond 10):");
const big = map.nodes.filter((n) => n.files.length > 10);
console.log(big.map((n) => `${labels.get(n.id)} (${n.files.length})`).join(", ") || "none");

console.log("\nlabels:");
console.log([...labels.entries()].map(([id, l]) => `${id} -> ${l}`).sort().join("\n"));