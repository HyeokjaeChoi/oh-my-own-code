import assert from "node:assert/strict";
import { builtinModules } from "node:module";
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtureRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/boundaries",
);
const approvedExternal = new Set([
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom/client",
  "@assistant-ui/react",
  "@assistant-ui/react-markdown",
  "remark-gfm",
  "lucide-react",
  "zod",
]);
const builtins = new Set(
  builtinModules.map((name) => name.replace(/^node:/, "")),
);
const layers = ["app", "pages", "widgets", "features", "entities", "shared"];
const scriptPattern = /\.[cm]?[jt]sx?$/;
const indexPattern = /^index\.[cm]?[jt]sx?$/;

function within(parent, child) {
  const path = relative(parent, child);
  return (
    path === "" ||
    (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`))
  );
}

function sourceFiles(folder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(folder, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Browser source symlink: ${path}`);
    if (entry.isDirectory()) return sourceFiles(path);
    return scriptPattern.test(path) || extname(path) === ".css" ? [path] : [];
  });
}

function importNodes(source) {
  const found = [];
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause;
        const elements = ts.isExportDeclaration(node)
          ? node.exportClause && ts.isNamedExports(node.exportClause)
            ? node.exportClause.elements
            : undefined
          : clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
            ? clause.namedBindings.elements
            : undefined;
        const typeOnly = Boolean(
          node.isTypeOnly ||
            clause?.isTypeOnly ||
            (!clause?.name &&
              elements?.length &&
              elements.every((item) => item.isTypeOnly)),
        );
        found.push({ specifier: node.moduleSpecifier.text, typeOnly, node });
      }
    } else if (ts.isImportTypeNode(node)) {
      if (
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      ) {
        found.push({
          specifier: node.argument.literal.text,
          typeOnly: true,
          node,
        });
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      found.push({
        specifier: node.moduleReference.expression?.text ?? null,
        typeOnly: node.isTypeOnly,
        node,
      });
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      const first = node.arguments[0];
      found.push({
        specifier: first && ts.isStringLiteralLike(first) ? first.text : null,
        typeOnly: false,
        node,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

// CSS tokenization keeps comments/quoted examples out of dependency matching and
// decodes CSS escapes before interpreting @import, ICSS and Modules composition.
function cssTokens(text) {
  const tokens = [];
  let position = 0;
  function escaped() {
    position++;
    const hex = /^[\da-f]{1,6}/i.exec(text.slice(position));
    if (hex) {
      position += hex[0].length;
      if (/\s/.test(text[position] ?? "")) position++;
      const code = parseInt(hex[0], 16);
      return code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "\ufffd";
    }
    const character = text[position++] ?? "";
    return character === "\n" || character === "\r" ? "" : character;
  }
  while (position < text.length) {
    if (/\s/.test(text[position])) {
      position++;
      continue;
    }
    if (text.slice(position, position + 2) === "/*") {
      const end = text.indexOf("*/", position + 2);
      if (end < 0) throw new Error("unterminated CSS comment");
      position = end + 2;
      continue;
    }
    const start = position;
    let value = "";
    if (text[position] === '"' || text[position] === "'") {
      const quote = text[position++];
      while (position < text.length && text[position] !== quote) {
        value += text[position] === "\\" ? escaped() : text[position++];
      }
      if (text[position] !== quote) throw new Error("unterminated CSS string");
      position++;
      tokens.push({ kind: "string", text: value, start });
    } else if (/[\w-]/.test(text[position]) || text[position] === "\\") {
      while (
        position < text.length &&
        (/[\w-]/.test(text[position]) || text[position] === "\\")
      ) {
        value += text[position] === "\\" ? escaped() : text[position++];
      }
      tokens.push({ kind: "word", text: value, start });
    } else {
      tokens.push({ kind: "symbol", text: text[position++], start });
    }
  }
  return tokens;
}

function cssDependencies(text) {
  const tokens = cssTokens(text);
  const found = [];
  function dependency(token, specifier, issue) {
    found.push({ specifier, typeOnly: false, start: token.start, issue });
  }
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const next = tokens[index + 1];
    if (token.text === "@" && next?.text.toLowerCase() === "import") {
      const value = tokens[index + 2];
      if (value?.kind === "string") dependency(token, value.text);
      else if (
        value?.text.toLowerCase() === "url" &&
        tokens[index + 3]?.text === "("
      ) {
        let end = index + 4;
        while (end < tokens.length && tokens[end].text !== ")") end++;
        const contents = tokens.slice(index + 4, end);
        const specifier = contents.map((item) => item.text).join("");
        dependency(
          token,
          specifier || null,
          end === tokens.length ? "uninspectable CSS import" : undefined,
        );
      } else dependency(token, null, "uninspectable CSS import");
    } else if (
      ["composes", "composes-with"].includes(token.text.toLowerCase()) &&
      next?.text === ":"
    ) {
      let end = index + 2;
      while (end < tokens.length && ![";", "}"].includes(tokens[end].text))
        end++;
      const from = tokens
        .slice(index + 2, end)
        .findIndex((item) => item.text === "from");
      if (from >= 0) {
        const value = tokens[index + 3 + from];
        dependency(
          token,
          value?.kind === "string" ? value.text : null,
          value?.text === "global"
            ? "global CSS composition is not approved"
            : value?.kind !== "string"
              ? "uninspectable CSS composition"
              : undefined,
        );
      }
    } else if (token.text === "@" && next?.text.toLowerCase() === "value") {
      let end = index + 2;
      while (end < tokens.length && tokens[end].text !== ";") end++;
      const from = tokens
        .slice(index + 2, end)
        .findIndex((item) => item.text === "from");
      if (from >= 0) {
        const value = tokens[index + 3 + from];
        dependency(
          token,
          value?.kind === "string" ? value.text : null,
          value?.kind !== "string"
            ? "uninspectable CSS value import"
            : undefined,
        );
      }
    } else if (
      token.text === ":" &&
      next?.text === "import" &&
      tokens[index + 2]?.text === "("
    ) {
      const value = tokens[index + 3];
      dependency(
        token,
        value?.kind === "string" ? value.text : null,
        value?.kind !== "string" ? "uninspectable ICSS import" : undefined,
      );
    }
  }
  return found;
}

function checkProject(projectRoot, entries) {
  const app = resolve(projectRoot, "apps/desktop-app");
  const renderer = resolve(app, "src/renderer");
  const bootstrap = resolve(app, "src/renderer.tsx");
  const bridgeTypes = resolve(app, "src/desktop-bridge.d.ts");
  const ui = resolve(projectRoot, "packages/ui/src");
  const contracts = resolve(projectRoot, "packages/contracts/src");
  const sharedRoots = [ui, contracts];
  const primitives = resolve(ui, "primitives");
  const storeModel = resolve(renderer, "entities/workbench/model");
  const storeSelector = resolve(storeModel, "store-selector.tsx");
  const globalStyles = new Set([
    resolve(app, "src/renderer.css"),
    resolve(projectRoot, "docs/design/tokens/tokens.css"),
  ]);
  // P2 migration only: these exact flat shared files are the runnable baseline.
  // Remove together after their consumers move to shared segment APIs in P5.
  const transitionalShared = new Set(
    ["index.ts", "request.ts", "projection.mjs", "projection.d.mts"].map(
      (file) => resolve(renderer, "shared", file),
    ),
  );
  const configFile = ts.readConfigFile(
    resolve(app, "tsconfig.json"),
    ts.sys.readFile,
  );
  if (configFile.error)
    throw new Error("Unable to read desktop TypeScript configuration");
  const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, app);
  if (config.errors.length)
    throw new Error("Invalid desktop TypeScript configuration");

  function rendererOwner(file) {
    if (!within(renderer, file)) return null;
    const parts = relative(renderer, file).split(sep);
    const [layer, name] = parts;
    if (!layers.includes(layer) || parts.length < 2) return null;
    if (layer === "app")
      return { layer, root: resolve(renderer, layer), index: 0 };
    if (layer === "shared" && transitionalShared.has(file)) {
      return {
        layer,
        root: resolve(renderer, "shared"),
        index: 5,
        transitional: true,
      };
    }
    if (parts.length < 3 || name.includes(".")) return null;
    return {
      layer,
      root: resolve(renderer, layer, name),
      index: layers.indexOf(layer),
    };
  }

  function styleOwner(file) {
    const owner = rendererOwner(file);
    if (owner && !owner.transitional) return owner.root;
    if (within(ui, file)) {
      const parts = relative(ui, file).split(sep);
      if (parts.length < 2) return null;
      // Tool UI components and nested primitives own their component subtree;
      // flat primitive wrappers own the primitives directory.
      return resolve(
        ui,
        ...parts.slice(
          0,
          parts[0] === "tool-ui" ||
            (parts[0] === "primitives" && parts.length > 2)
            ? 2
            : 1,
        ),
      );
    }
    return null;
  }

  function stylesheetViolation(from, target) {
    if (globalStyles.has(target)) {
      return from === bootstrap ||
        from === resolve(renderer, "app/index.tsx") ||
        globalStyles.has(from)
        ? null
        : "global styles may only be loaded by renderer bootstrap";
    }
    if (!within(renderer, target) && !within(ui, target))
      return "unapproved stylesheet source";
    if (within(renderer, target) && !rendererOwner(target))
      return "unknown renderer layer or segment";
    if (!target.endsWith(".module.css"))
      return "component styles must use CSS Modules";
    const owner = styleOwner(from);
    return owner && owner === styleOwner(target)
      ? null
      : "stylesheet crosses ownership boundary";
  }

  function localViolation(from, target, typeOnly) {
    if (
      sharedRoots.some((folder) => within(folder, from)) &&
      within(app, target)
    )
      return "shared package imports application";
    if (target === bridgeTypes)
      return typeOnly ? null : "bridge DTOs must be type-only";
    if (extname(target) === ".css") return stylesheetViolation(from, target);
    const packageRoot = sharedRoots.find((folder) => within(folder, target));
    if (packageRoot) {
      if (within(contracts, from) && packageRoot === ui)
        return "contracts cannot import UI";
      if (
        !within(packageRoot, from) &&
        target !== resolve(packageRoot, "index.ts")
      )
        return "shared package deep import bypasses its public API";
      return null;
    }
    if (!within(renderer, target))
      return "renderer reaches host or another application";
    if (sharedRoots.some((folder) => within(folder, from)))
      return "shared package imports application";
    const source = rendererOwner(from);
    const destination = rendererOwner(target);
    if (!destination || (within(renderer, from) && !source))
      return "unknown renderer layer or segment";
    if (source && destination.index < source.index)
      return "upward renderer layer import";
    if (source?.root === destination.root) return null;
    if (
      source?.layer === destination.layer &&
      !["app", "shared"].includes(destination.layer)
    )
      return "sibling slice import";
    if (destination.layer === "app") return null;
    if (
      destination.transitional &&
      target === resolve(renderer, "shared/index.ts")
    )
      return null;
    if (
      dirname(target) !== destination.root ||
      !indexPattern.test(target.split(sep).at(-1))
    )
      return destination.layer === "shared"
        ? "shared segment deep import bypasses its public API"
        : "slice deep import bypasses its public API";
    return null;
  }

  function externalViolation(file, item) {
    const specifier = item.specifier;
    if (specifier === "radix-ui")
      return within(primitives, file)
        ? null
        : "radix-ui is restricted to UI primitive implementation";
    if (specifier === "zustand/vanilla")
      return within(storeModel, file)
        ? null
        : "zustand/vanilla is restricted to the workbench model";
    if (specifier === "zustand" || specifier === "zustand/react") {
      if (file !== storeSelector)
        return "Zustand React selectors are restricted to store-selector.tsx";
      const bindings = item.node?.importClause?.namedBindings;
      return item.node &&
        ts.isImportDeclaration(item.node) &&
        !item.node.importClause.name &&
        bindings &&
        ts.isNamedImports(bindings) &&
        bindings.elements.length > 0 &&
        bindings.elements.every(
          (element) =>
            (element.propertyName ?? element.name).text === "useStore",
        )
        ? null
        : "store-selector.tsx may only import named useStore from Zustand React";
    }
    if (specifier.startsWith("zustand/")) return "unapproved Zustand entry";
    return approvedExternal.has(specifier) ? null : undefined;
  }

  // TypeScript resolves JS extension substitutions, aliases and public package
  // exports. CSS is a real asset, so resolve its literal/configured alias paths
  // rather than accepting an ambient *.css declaration as the dependency.
  function resolveDependency(specifier, file) {
    const literal = specifier.startsWith(".")
      ? resolve(dirname(file), specifier)
      : null;
    if (literal && existsSync(literal) && statSync(literal).isFile())
      return realpathSync(literal);
    if (specifier.endsWith(".css")) {
      for (const [pattern, targets] of Object.entries(
        config.options.paths ?? {},
      )) {
        const star = pattern.indexOf("*");
        const prefix = star < 0 ? pattern : pattern.slice(0, star);
        const suffix = star < 0 ? "" : pattern.slice(star + 1);
        if (
          star < 0
            ? specifier !== pattern
            : !specifier.startsWith(prefix) || !specifier.endsWith(suffix)
        )
          continue;
        const substitution =
          star < 0
            ? ""
            : specifier.slice(prefix.length, specifier.length - suffix.length);
        for (const path of targets) {
          const candidate = resolve(
            config.options.baseUrl ?? app,
            path.replace("*", substitution),
          );
          if (existsSync(candidate) && statSync(candidate).isFile())
            return realpathSync(candidate);
        }
      }
      return null;
    }
    const target = ts.resolveModuleName(specifier, file, config.options, ts.sys)
      .resolvedModule?.resolvedFileName;
    return target ? realpathSync(target) : null;
  }

  const errors = [];
  const visited = new Set();
  const queue = entries ?? [bootstrap, ...sourceFiles(renderer)];
  function report(file, item, issue) {
    const text = readFileSync(file, "utf8");
    const start = item.node?.getStart() ?? item.start ?? 0;
    const line = text.slice(0, start).split("\n").length;
    errors.push({
      file: relative(projectRoot, file),
      line,
      issue,
      specifier: item.specifier,
    });
  }
  while (queue.length) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    if (within(renderer, file) && !rendererOwner(file)) {
      report(file, {}, "unknown renderer layer or segment");
      continue;
    }
    if (
      extname(file) === ".css" &&
      !globalStyles.has(file) &&
      !file.endsWith(".module.css")
    ) {
      report(file, {}, "component styles must use CSS Modules");
      continue;
    }
    const text = readFileSync(file, "utf8");
    let imports;
    try {
      imports =
        extname(file) === ".css"
          ? cssDependencies(text)
          : importNodes(
              ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true),
            );
    } catch (error) {
      report(file, {}, error.message);
      continue;
    }
    for (const item of imports) {
      const specifier = item.specifier;
      let issue = item.issue;
      let target;
      if (!issue) {
        if (specifier === null)
          issue = "computed import/require is not an inspectable dependency";
        else if (specifier.includes("?") || specifier.includes("#"))
          issue = "query-based module loader is not approved";
        else if (specifier.startsWith("node:") || builtins.has(specifier))
          issue = "Node builtin in renderer graph";
        else if (
          extname(file) === ".css" &&
          /^(?:[a-z][\w+.-]*:|\/\/|\/)/i.test(specifier)
        )
          issue = "external stylesheet dependency is not approved";
        else {
          const external = externalViolation(file, item);
          if (external !== undefined) {
            issue = external;
            if (!issue) {
              const dependency = ts.resolveModuleName(
                specifier,
                file,
                config.options,
                ts.sys,
              ).resolvedModule;
              if (!dependency) issue = "unresolved approved dependency";
              else if (
                within(app, dependency.resolvedFileName) ||
                within(
                  resolve(projectRoot, "packages"),
                  dependency.resolvedFileName,
                )
              )
                issue =
                  "approved external dependency resolves to application source";
            }
          } else {
            target = resolveDependency(specifier, file);
            if (!target) issue = "unresolved or unapproved dependency";
            else {
              issue = localViolation(file, target, item.typeOnly);
              if (!issue) queue.push(target);
            }
          }
        }
      }
      if (issue) report(file, item, issue);
    }
  }
  return { errors, visited: visited.size };
}

function runFixtures() {
  const project = resolve(fixtureRoot, "project");
  const cases = JSON.parse(
    readFileSync(resolve(fixtureRoot, "cases.json"), "utf8"),
  );
  for (const fixture of cases) {
    const current = fixture.project
      ? resolve(fixtureRoot, fixture.project)
      : project;
    const result = checkProject(current, [resolve(current, fixture.entry)]);
    assert.deepEqual(
      result.errors.map((error) => error.issue),
      fixture.issues,
      `Boundary fixture: ${fixture.name}\n${JSON.stringify(result.errors)}`,
    );
  }
  return {
    total: cases.length,
    positive: cases.filter((fixture) => fixture.issues.length === 0).length,
  };
}

const fixtures = runFixtures();
if (
  process.argv.length > 3 ||
  (process.argv[2] && process.argv[2] !== "--fixtures-only")
) {
  throw new Error(
    "Usage: node check-renderer-boundaries.mjs [--fixtures-only]",
  );
}
const result =
  process.argv[2] === "--fixtures-only"
    ? { errors: [], visited: 0 }
    : checkProject(root);
if (result.errors.length) {
  console.error(
    result.errors
      .map(
        ({ file, line, issue, specifier }) =>
          `${file}:${line}: ${issue} (${specifier ?? "source"})`,
      )
      .join("\n"),
  );
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify({
      result: "pass",
      sourceFiles: result.visited,
      boundaryFixtures: fixtures.total,
      positiveFixtures: fixtures.positive,
    }),
  );
}
