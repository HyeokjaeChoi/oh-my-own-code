export const forbiddenImportFixtures = [
  {
    name: "relative import from browser source into bridge source",
    kind: "browser",
    importer: "apps/workbench-web/src/widgets/session-workspace/ui/fixture.tsx",
    sourceText: 'import "../../../../../local-bridge/src/server.js";',
    expectedCode: "browser-bridge-import",
  },
  {
    name: "page import from the higher app layer",
    kind: "browser",
    importer: "apps/workbench-web/src/pages/workbench/ui/fixture.tsx",
    sourceText: 'import "../../../app/App.js";',
    expectedCode: "fsd-layer-direction",
  },
  {
    name: "entity import into another slice's private module",
    kind: "browser",
    importer: "apps/workbench-web/src/entities/user/model/fixture.ts",
    sourceText: 'import "../../session/model/assistant-thread.js";',
    expectedCode: "fsd-cross-slice-internal-import",
  },
  {
    name: "bridge import from renderer UI package",
    kind: "bridge",
    importer: "apps/local-bridge/src/server.ts",
    sourceText: 'import "../../../packages/ui/src/index.js";',
    expectedCode: "bridge-ui-import",
  },
  {
    name: "shared UI package import from renderer source",
    kind: "package",
    importer: "packages/ui/src/index.ts",
    sourceText: 'import "../../../apps/workbench-web/src/main.js";',
    expectedCode: "package-browser-import",
  },
  {
    name: "browser import from a private UI package module",
    kind: "browser",
    importer: "apps/workbench-web/src/widgets/session-workspace/ui/fixture.tsx",
    sourceText:
      'import { LinkPreview } from "@workbench/ui/tool-ui/link-preview/link-preview.js";',
    expectedCode: "workspace-package-deep-import",
  },
  {
    name: "UI package import of a Node builtin",
    kind: "package",
    importer: "packages/ui/src/fixture.tsx",
    sourceText: 'import { readFile } from "node:fs"; void readFile;',
    expectedCode: "browser-node-import",
  },
  {
    name: "contracts package import of an unprefixed Node builtin",
    kind: "package",
    importer: "packages/contracts/src/fixture.ts",
    sourceText: 'import { readFile } from "fs"; void readFile;',
    expectedCode: "browser-node-import",
  },
];

export const allowedImportFixtures = [
  {
    name: "widget import through an entity public entry",
    kind: "browser",
    importer: "apps/workbench-web/src/widgets/session-workspace/ui/fixture.tsx",
    sourceText: 'import "../../../entities/session/index.js";',
  },
  {
    name: "browser import through the UI package entry",
    kind: "browser",
    importer: "apps/workbench-web/src/widgets/session-workspace/ui/fixture.tsx",
    sourceText: 'import { LinkPreview } from "@workbench/ui";',
  },
  {
    name: "browser import through the contracts source entry",
    kind: "browser",
    importer: "apps/workbench-web/src/entities/session/model/fixture.ts",
    sourceText:
      'import { SyntheticSnapshotSchema } from "@workbench/contracts/source";',
  },
  {
    name: "bridge import through the contracts source entry",
    kind: "bridge",
    importer: "apps/local-bridge/src/server.ts",
    sourceText:
      'import { SyntheticSnapshotSchema } from "@workbench/contracts/source";',
  },
];
