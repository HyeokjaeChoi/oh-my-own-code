import ts from "typescript";

// Parse actual module syntax. Recipe data and comments may contain source text.
export function localResourceImports(text, filename = "resource.mjs") {
  if (filename.endsWith(".json")) {
    JSON.parse(text);
    return [];
  }
  const source = ts.createSourceFile(
    "resource.mjs",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  if (source.parseDiagnostics.length)
    throw new Error("Invalid resource module syntax");
  const imports = [];
  const add = (node) => {
    if (
      node &&
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      node.text.startsWith(".")
    )
      imports.push(node.text);
  };
  const dynamic = (node) => {
    if (ts.isTemplateExpression(node) && node.head.text.startsWith("."))
      throw new Error("Unrecognized dynamic resource import graph");
    add(node);
    ts.forEachChild(node, dynamic);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      add(node.moduleSpecifier);
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0]
    )
      dynamic(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
}
