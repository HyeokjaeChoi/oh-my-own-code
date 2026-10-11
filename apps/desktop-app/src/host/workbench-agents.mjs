// Fixed flat Agent paths through the shared guarded source reader.
import {
  listConfigurationSourceFiles,
  readConfigurationSourceFile,
} from "./configuration-source-files.mjs";
export const listAgentFiles = (workspace, options) =>
  listConfigurationSourceFiles("agent", workspace, options);
export const readAgentFile = (workspace, sourceName, options) =>
  readConfigurationSourceFile("agent", workspace, sourceName, options);
