// Closed staged-source allowlist. Pure data shared by staging and test-copy helpers.
export const CONFIGURATION_SAVE_ASSETS = Object.freeze([
  "host/configuration-save-kernel.mjs",
  "host/configuration-save-shared.mjs",
  "host/configuration-save-kernel-win32.mjs",
  "host/darwin-descriptor-ffi.mjs",
  "host/workspace-root-authority.mjs",
  "renderer/shared/workspace-file/index.mjs",
  "host/configuration-file-observation.mjs",
  "renderer/shared/configuration-draft/validation.mjs",
  "renderer/shared/configuration-draft/skill.mjs",
]);
export const NATIVE_SKILLS_ASSETS = Object.freeze([
  "native-skills-config.mjs",
  "native-skills-protocol.mjs",
  "builtins/workbench-skills/package.json",
  "builtins/workbench-skills/server.mjs",
]);
export const NATIVE_AGENTS_ASSETS = Object.freeze([
  "native-agents-protocol.mjs",
  "renderer/shared/configuration-draft/agent-runtime.mjs",
  "builtins/workbench-skills/agents.mjs",
  "renderer/shared/configuration-draft/agent.mjs",
  "renderer/shared/configuration-draft/policy.mjs",
]);
export const NATIVE_EXTENSIONS_ASSETS = Object.freeze([
  "native-extensions-protocol.mjs",
  "renderer/shared/configuration-draft/extensions.mjs",
  "builtins/workbench-skills/extensions.mjs",
]);
export const GIT_BRANCH_RESTORE_ASSETS = Object.freeze([
  "host/git-branch-restore-kernel.mjs",
  "host/git-branch-restore-contract.mjs",
  "renderer/shared/git-branch-restore/index.mjs",
]);
export const GIT_COMMIT_ASSETS = Object.freeze([
  "host/git-metadata-kernel.mjs",
  "host/git-commit-kernel.mjs",
  "host/git-commit-contract.mjs",
  "renderer/shared/git-commit/index.mjs",
]);
export const GIT_INDEX_ASSETS = Object.freeze([
  "host/git-index-kernel.mjs",
  "host/git-index-contract.mjs",
  "renderer/shared/git-index/index.mjs",
  "renderer/shared/git-review/index.mjs",
]);
export const EVENT_HOST_CODE_ASSETS = Object.freeze([
  "event-host-code-assets.mjs",
  "native-permission-overlay-contract.mjs",
  "native-permission-graph.mjs",
  "native-permission-control.mjs",
  "host/native-bootstrap-workspace.mjs",
  "platform-paths.mjs",
  "native-permission-control-input.mjs",
  "native-permission-inventory.mjs",
  "native-permission-tool-data.mjs",
  "native-permission-leases.mjs",
  "native-permission-origin-scopes.mjs",
  "permission-control-canonical.mjs",
  "native-permission-task-observer.mjs",
  "host/native-workspace-file-io.mjs",
  "host/native-descriptor-read.mjs",
  "host/native-descriptor-read-win32.mjs",
  "host/darwin-directory-entry.mjs",
  "host/native-descriptor-read-resource.mjs",
  "host/native-read-auxiliary.mjs",
  "native-permission-read-effect.mjs",
  "host/workbench-file-edit.mjs",
  "workbench-errors.mjs",
  "native-permission-task-handoff.mjs",
  "permission-input-digest.mjs",
  "native-permission-bootstrap-digest.mjs",
  "wire-id.mjs",
  "host/workbench-task-storage.mjs",
  "native-permission-coordinator-admission.mjs",
  ...GIT_BRANCH_RESTORE_ASSETS,
  ...GIT_COMMIT_ASSETS,
  ...GIT_INDEX_ASSETS,
  ...CONFIGURATION_SAVE_ASSETS,
  ...NATIVE_SKILLS_ASSETS,
  ...NATIVE_AGENTS_ASSETS,
  ...NATIVE_EXTENSIONS_ASSETS,
]);
