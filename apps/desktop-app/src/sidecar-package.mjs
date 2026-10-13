export function sidecarPackageName(platform, architecture) {
  const packagePlatform = platform === "win32" ? "windows" : platform;
  return `@opencode/cli-${packagePlatform}-${architecture}`;
}

export const sidecarBinaryName = (platform) =>
  platform === "win32" ? "opencode.exe" : "opencode";
