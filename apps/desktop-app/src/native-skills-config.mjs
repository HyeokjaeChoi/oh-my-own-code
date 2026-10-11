import { lstatSync, realpathSync, readFileSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { EVENT_HOST_CONFIG } from "./event-host-protocol.mjs";

// The supervisor first verifies the full resource manifest. The child accepts
// only this fixed contained directory; nonce never enters persistent config.
export function nativeSkillsConfig(root, nonce) {
  const fail = () => {
    throw new Error("native_skill_resources_unverified");
  };
  if (
    typeof root !== "string" ||
    !isAbsolute(root) ||
    normalize(root) !== root ||
    !/^[a-f0-9]{64}$/u.test(nonce)
  )
    fail();
  for (const path of [
    root,
    join(root, "builtins"),
    join(root, "builtins/workbench-skills"),
  ])
    if (realpathSync(path) !== path || !lstatSync(path).isDirectory()) fail();
  const plugin = join(root, "builtins/workbench-skills");
  for (const name of ["package.json", "server.mjs"]) {
    const path = join(plugin, name),
      stat = lstatSync(path);
    if (!stat.isFile() || stat.nlink !== 1 || realpathSync(path) !== path)
      fail();
  }
  const packagePath = join(plugin, "package.json");
  if (lstatSync(packagePath).size > 4096) fail();
  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  if (
    !pkg ||
    Object.keys(pkg).sort().join() !== "name,private,type,version" ||
    pkg.name !== "@oh-my-own-code/workbench-skills" ||
    pkg.version !== "1.0.0" ||
    pkg.private !== true ||
    pkg.type !== "module"
  )
    fail();
  // Native substitutes raw {env:...}/{file:...} before JSON decoding. Keep
  // checked resource names literal; JSON decoding restores each opening brace.
  return JSON.stringify({
    ...JSON.parse(EVENT_HOST_CONFIG),
    plugins: [{ package: plugin, options: { nonce } }],
  })
    .replaceAll("{env:", "\\u007benv:")
    .replaceAll("{file:", "\\u007bfile:");
}
