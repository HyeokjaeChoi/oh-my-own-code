// Test-only: lets node import *.css modules; class names resolve to their key.
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`export async function load(url, ctx, next) {
  if (url.endsWith(".css"))
    return { format: "module", shortCircuit: true, source: "export default new Proxy({}, { get: (_, k) => String(k) });" };
  return next(url, ctx);
}`),
);
