// Fixed Skill paths through the shared guarded source reader.
import {
  listConfigurationSourceFiles,
  readConfigurationSourceFile,
} from "./configuration-source-files.mjs";
export const listSkillFiles = (workspace, options) =>
  listConfigurationSourceFiles("skill", workspace, options);
export const readSkillFile = (workspace, sourceName, options) =>
  readConfigurationSourceFile("skill", workspace, sourceName, options);
