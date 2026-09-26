// One-off: extract Vela's real drawing-tool icon SVGs into a TS module.
const fs = require("fs");
const path = "node_modules/@luxalgo/vela/dist/chunk-BFA32GOU.js";
const s = fs.readFileSync(path, "utf8");

// icon consts (tolerant of newlines/extra spaces inside svg24(...))
const iconRe = /var ([A-Z0-9_]+_ICON) = svg24\(\s*'([\s\S]*?)'\s*\)/g;
let m;
const icons = {};
while ((m = iconRe.exec(s))) icons[m[1]] = m[2].replace(/\s+/g, " ").trim();
console.log("icon consts:", Object.keys(icons).length);

// registrations: { type, group, label, icon }
const regRe =
  /registerDrawingType\(\{\s*type: "([a-z0-9-]+)",\s*group: "([^"]*)",\s*label: "([^"]*)",\s*icon: ([A-Z0-9_]+)/g;
let r;
const tools = [];
while ((r = regRe.exec(s))) tools.push({ type: r[1], group: r[2], label: r[3], icon: r[4] });
console.log("tools:", tools.length);
const missing = tools.filter((t) => !icons[t.icon]).map((t) => t.icon);
console.log("missing icons:", missing.length, missing.join(","));

// Emit the TS module. The svg field holds the INNER markup of Vela's svg24()
// helper — paths/lines only, no <svg> wrapper — so the bar wraps it itself
// with the same viewBox/stroke attributes Vela uses.
const out = [
  "/**",
  " * velaToolIcons — Vela's OWN drawing-tool icons + labels, extracted from",
  " * @luxalgo/vela's toolbar registry at build time. The favourites bar renders",
  " * these so its glyphs are IDENTICAL to the ones in Vela's drawing toolbar.",
  " * Each `svg` is the INNER markup of Vela's svg24() helper (paths/lines, no",
  " * <svg> element); wrap it with viewBox 0 0 24 24 to render.",
  " * Regenerate with: node scripts/extract-vela-icons.cjs",
  " */",
  "export interface VelaTool { type: string; label: string; group: string; svg: string; }",
  "",
  "export const VELA_TOOLS: VelaTool[] = [",
];
for (const t of tools) {
  const svg = icons[t.icon] ?? "";
  out.push(
    `  { type: ${JSON.stringify(t.type)}, label: ${JSON.stringify(t.label)}, group: ${JSON.stringify(t.group)}, svg: ${JSON.stringify(svg)} },`,
  );
}
out.push("];");
out.push("");
out.push("export const VELA_TOOL_MAP: Record<string, VelaTool> = Object.fromEntries(");
out.push("  VELA_TOOLS.map((t) => [t.type, t]),");
out.push(");");
fs.writeFileSync("src/lib/velaToolIcons.ts", out.join("\n"));
console.log("wrote src/lib/velaToolIcons.ts", out.join("\n").length, "bytes");
