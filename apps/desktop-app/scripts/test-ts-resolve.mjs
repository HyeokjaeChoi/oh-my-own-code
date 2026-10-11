import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
registerHooks({
  resolve(spec, ctx, next) {
    if (
      /^\.\.?\//.test(spec) &&
      spec.endsWith(".js") &&
      ctx.parentURL?.startsWith("file:")
    ) {
      const u = new URL(spec, ctx.parentURL);
      if (!existsSync(fileURLToPath(u)))
        for (const e of [".ts", ".tsx"]) {
          const c = new URL(spec.slice(0, -3) + e, ctx.parentURL);
          if (existsSync(fileURLToPath(c))) return next(c.href, ctx);
        }
    }
    return next(spec, ctx);
  },
});
