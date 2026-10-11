// Read-only test input discovery. Never imports the discovered modules.
import ts from "typescript";
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { localResourceImports } from "./local-resource-imports.mjs";
const repository = fileURLToPath(new URL("../../../", import.meta.url));
export async function permissionTestInputClosure(files) {
  const pending = [...files],
    seen = new Set();
  while (pending.length) {
    const file = pending.shift();
    if (seen.has(file)) continue;
    const absolute = resolve(repository, file),
      rel = relative(repository, absolute).split(sep).join("/");
    if (
      rel !== file ||
      !file.startsWith("apps/desktop-app/") ||
      file.includes("/.generated/")
    )
      throw Error("unclosed_test_input_path");
    seen.add(file);
    const text = await readFile(absolute, "utf8");
    const add = (specifier) =>
      pending.push(
        relative(repository, resolve(dirname(absolute), specifier))
          .split(sep)
          .join("/"),
      );
    for (const specifier of localResourceImports(text, file)) add(specifier);
    if (file.endsWith(".json")) continue;
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        if (node.expression.text === "copyPermissionControlSources")
          pending.push("apps/desktop-app/src/native-permission-control.mjs");
        if (
          node.expression.text === "copyPermissionTestSources" &&
          file.endsWith(".test.mjs")
        ) {
          const roots = node.arguments[1];
          if (
            !roots ||
            !ts.isArrayLiteralExpression(roots) ||
            roots.elements.some((item) => !ts.isStringLiteral(item))
          )
            throw Error("unclosed_test_copy_roots");
          for (const item of roots.elements)
            pending.push(`apps/desktop-app/src/${item.text}`);
        }
      }
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "URL" &&
        node.arguments?.length === 2 &&
        ts.isStringLiteral(node.arguments[0]) &&
        node.arguments[1].getText(source) === "import.meta.url"
      ) {
        const target = relative(
          repository,
          resolve(dirname(absolute), node.arguments[0].text),
        )
          .split(sep)
          .join("/");
        if (
          /^apps\/desktop-app\/(src|scripts)\//u.test(target) &&
          /\.(mjs|json)$/u.test(target)
        )
          pending.push(target);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...seen].sort();
}
