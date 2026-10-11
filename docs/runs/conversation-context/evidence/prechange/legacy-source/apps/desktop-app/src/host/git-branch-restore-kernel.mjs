// Compatibility facade; descriptor authority belongs to one shared core.
import { createGitMetadataKernel } from "./git-metadata-kernel.mjs";
export async function createGitBranchRestoreKernel(options = {}) {
  return (await createGitMetadataKernel(options)).branchRestore;
}
