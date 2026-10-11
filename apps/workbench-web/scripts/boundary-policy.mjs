import { builtinModules } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(scriptDirectory, "../../..");
export const appsRoot = resolve(repositoryRoot, "apps");
export const packagesRoot = resolve(repositoryRoot, "packages");
export const browserSourceRoot = resolve(
  repositoryRoot,
  "apps/workbench-web/src",
);
export const bridgeSourceRoot = resolve(
  repositoryRoot,
  "apps/local-bridge/src",
);
export const uiSourceRoot = resolve(repositoryRoot, "packages/ui/src");
export const contractsSourceRoot = resolve(
  repositoryRoot,
  "packages/contracts/src",
);

const tsconfigPath = resolve(
  repositoryRoot,
  "apps/workbench-web/tsconfig.json",
);
const tsconfig = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
if (tsconfig.error)
  throw new Error(
    ts.flattenDiagnosticMessageText(tsconfig.error.messageText, "\n"),
  );
const compilerOptions = ts.parseJsonConfigFileContent(
  tsconfig.config,
  ts.sys,
  dirname(tsconfigPath),
).options;
const sourceLayers = [
  "app",
  "pages",
  "widgets",
  "features",
  "entities",
  "shared",
];

function isWithin(path, parent) {
  const relativePath = relative(parent, path);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${sep}`) &&
      relativePath !== ".." &&
      !isAbsolute(relativePath))
  );
}

function getWorkspaceOwner(path) {
  if (isWithin(path, browserSourceRoot)) return "browser";
  if (isWithin(path, bridgeSourceRoot)) return "bridge";
  if (isWithin(path, uiSourceRoot)) return "ui";
  if (isWithin(path, contractsSourceRoot)) return "contracts";
  return null;
}

const publicPackageEntries = {
  "@workbench/contracts": {
    owner: "contracts",
    target: resolve(contractsSourceRoot, "index.ts"),
    specifiers: new Set([
      "@workbench/contracts",
      "@workbench/contracts/source",
    ]),
  },
  "@workbench/ui": {
    owner: "ui",
    target: resolve(uiSourceRoot, "index.ts"),
    specifiers: new Set(["@workbench/ui"]),
  },
};

function getWorkspaceImportViolation(owner, specifier, target, importer) {
  const packagePrefix = specifier.match(
    /^@workbench\/(contracts|ui)(?:\/.*)?$/,
  );
  const importedPackage = packagePrefix
    ? `@workbench/${packagePrefix[1]}`
    : null;
  const entry = importedPackage ? publicPackageEntries[importedPackage] : null;
  const targetOwner = target ? getWorkspaceOwner(target) : null;

  if (importedPackage && (!entry || !entry.specifiers.has(specifier))) {
    return {
      code: "workspace-package-deep-import",
      importer,
      target,
      specifier,
      message: `${specifier} is not a public workspace package entry`,
    };
  }

  if (!targetOwner || !owner || targetOwner === owner) return null;

  const publicEdge =
    importedPackage &&
    entry?.specifiers.has(specifier) &&
    entry.owner === targetOwner &&
    entry.target === target;
  const allowed =
    (owner === "browser" &&
      ((targetOwner === "ui" && importedPackage === "@workbench/ui") ||
        (targetOwner === "contracts" &&
          importedPackage === "@workbench/contracts")) &&
      publicEdge) ||
    (owner === "bridge" &&
      targetOwner === "contracts" &&
      importedPackage === "@workbench/contracts" &&
      publicEdge);
  if (allowed) return null;

  return {
    code:
      (owner === "ui" || owner === "contracts") && targetOwner === "browser"
        ? "package-browser-import"
        : (owner === "ui" || owner === "contracts") && targetOwner === "bridge"
          ? "package-bridge-import"
          : owner === "ui" || owner === "contracts"
            ? "package-workspace-import"
            : "workspace-import-direction",
    importer,
    target,
    specifier,
    message: `${owner} source must not import ${targetOwner} source through this edge`,
  };
}

export function getImportSpecifiers(sourceText, fileName = "fixture.tsx") {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const specifiers = [];

  function addStringLiteral(node) {
    if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text);
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addStringLiteral(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addStringLiteral(node.moduleReference.expression);
    } else if (ts.isCallExpression(node)) {
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")
      ) {
        addStringLiteral(node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

export function resolveSourceTarget(importer, specifier) {
  const resolved = ts.resolveModuleName(
    specifier,
    resolve(importer),
    compilerOptions,
    ts.sys,
  ).resolvedModule;
  return resolved ? resolve(resolved.resolvedFileName) : null;
}

function getFsdViolation(importer, target) {
  if (
    !isWithin(importer, browserSourceRoot) ||
    !isWithin(target, browserSourceRoot)
  )
    return null;

  const sourceParts = relative(browserSourceRoot, importer).split(sep);
  const targetParts = relative(browserSourceRoot, target).split(sep);
  const sourceLayer = sourceLayers.indexOf(sourceParts[0]);
  const targetLayer = sourceLayers.indexOf(targetParts[0]);
  if (sourceLayer < 0 || targetLayer < 0) return null;

  if (targetLayer > sourceLayer) return null;
  if (targetLayer < sourceLayer) {
    return {
      code: "fsd-layer-direction",
      message: `${sourceParts[0]} must not import from lower layer ${targetParts[0]}`,
    };
  }

  const sourceSlice = sourceParts[1] ?? sourceParts[0];
  const targetSlice = targetParts[1] ?? targetParts[0];
  const isPublicEntry = /^index(?:\.d)?\.[cm]?[jt]sx?$/.test(
    targetParts.at(-1) ?? "",
  );
  if (sourceSlice !== targetSlice && !isPublicEntry) {
    return {
      code: "fsd-cross-slice-internal-import",
      message: `${sourceParts[0]}/${sourceSlice} must use the public entry of ${targetParts[0]}/${targetSlice}`,
    };
  }
  return null;
}

function isNodeBuiltin(specifier) {
  const unprefixed = specifier.startsWith("node:")
    ? specifier.slice("node:".length)
    : specifier;
  return specifier.startsWith("node:") || builtinModules.includes(unprefixed);
}

export function analyzeSource({ importer, sourceText, kind }) {
  const sourcePath = resolve(importer);
  const owner = getWorkspaceOwner(sourcePath);
  const browserReachable =
    kind === "browser" ||
    (kind === "package" && (owner === "ui" || owner === "contracts"));
  const violations = [];

  for (const specifier of getImportSpecifiers(sourceText, sourcePath)) {
    if (browserReachable && isNodeBuiltin(specifier)) {
      violations.push({
        code: "browser-node-import",
        importer: sourcePath,
        specifier,
        message: "browser source must not import Node.js modules",
      });
    }
    if (specifier.startsWith("@opencode/")) {
      violations.push({
        code: "opencode-sdk-import",
        importer: sourcePath,
        specifier,
        message:
          "the synthetic bootstrap slice must not import the OpenCode SDK",
      });
    }

    const target = resolveSourceTarget(sourcePath, specifier);
    const workspaceImportViolation = getWorkspaceImportViolation(
      owner,
      specifier,
      target,
      sourcePath,
    );
    if (workspaceImportViolation) violations.push(workspaceImportViolation);
    if (!target) continue;

    if (kind === "browser" && isWithin(target, bridgeSourceRoot)) {
      violations.push({
        code: "browser-bridge-import",
        importer: sourcePath,
        target,
        specifier,
        message: "browser source must not import bridge source",
      });
    }
    if (kind === "browser") {
      const disallowedAppImport =
        isWithin(target, appsRoot) && !isWithin(target, browserSourceRoot);
      const disallowedPackageImport =
        isWithin(target, packagesRoot) &&
        !isWithin(target, uiSourceRoot) &&
        !isWithin(target, contractsSourceRoot);
      if (disallowedAppImport || disallowedPackageImport) {
        violations.push({
          code: "browser-unexpected-workspace-import",
          importer: sourcePath,
          target,
          specifier,
          message:
            "browser source may import only its own source, contracts, and UI workspace packages",
        });
      }
    }
    if (kind === "bridge" && isWithin(target, browserSourceRoot)) {
      violations.push({
        code: "bridge-browser-import",
        importer: sourcePath,
        target,
        specifier,
        message: "bridge source must not import browser source",
      });
    }
    if (kind === "bridge" && isWithin(target, uiSourceRoot)) {
      violations.push({
        code: "bridge-ui-import",
        importer: sourcePath,
        target,
        specifier,
        message:
          "the local bridge may import contracts but not renderer UI code",
      });
    }

    const fsdViolation = getFsdViolation(sourcePath, target);
    if (fsdViolation)
      violations.push({
        ...fsdViolation,
        importer: sourcePath,
        target,
        specifier,
      });
  }

  return violations;
}
