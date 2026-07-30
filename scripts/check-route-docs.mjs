import fs from "node:fs";
const app = fs.readFileSync(new URL("../src/core/app.ts", import.meta.url), "utf8");
const docs = fs.readFileSync(new URL("../docs/reference/api.md", import.meta.url), "utf8");
const block = app.slice(app.indexOf("export const ROUTES"), app.indexOf("export const ROUTE_INVENTORY"));
const routes = [...block.matchAll(/method:\s*"([A-Z]+)",\s*path:\s*"([^"]+)"/g)]
  .map(([, method, path]) => `${method} ${path}`).sort();
const start = "<!-- ROUTE_INVENTORY_START -->", end = "<!-- ROUTE_INVENTORY_END -->";
const section = docs.slice(docs.indexOf(start) + start.length, docs.indexOf(end));
const documented = [...section.matchAll(/^- `([A-Z]+) ([^`]+)`/gm)].map(([, method, path]) => `${method} ${path}`).sort();
if (!routes.length || docs.indexOf(start) < 0 || docs.indexOf(end) < 0) throw new Error("route inventory markers or router routes missing");
if (JSON.stringify(routes) !== JSON.stringify(documented)) {
  console.error("Route documentation drift. Expected:\n" + routes.map((r) => `- \`${r}\``).join("\n")); process.exit(1);
}
console.log(`route docs OK (${routes.length} routes)`);
