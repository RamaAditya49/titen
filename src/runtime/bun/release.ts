export const RELEASE_URL = "https://titen.dev/version.json";

const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export interface StableRelease {
  cliVersion: string;
  pluginVersion: string;
}

export async function fetchStableRelease(fetcher: typeof fetch = fetch): Promise<StableRelease> {
  let response: Response;
  try {
    response = await fetcher(RELEASE_URL, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new Error(`could not reach ${RELEASE_URL}`);
  }
  if (!response.ok) throw new Error(`release endpoint returned HTTP ${response.status}`);

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error("release endpoint returned invalid JSON");
  }
  if (!value || typeof value !== "object") throw new Error("invalid stable release manifest");

  const release = value as Record<string, unknown>;
  const cli = release.cli as Record<string, unknown> | undefined;
  const plugin = release.plugin as Record<string, unknown> | undefined;
  if (
    release.schema !== 1
    || release.channel !== "stable"
    || typeof cli?.version !== "string"
    || !STABLE_SEMVER.test(cli.version)
    || typeof plugin?.version !== "string"
    || !STABLE_SEMVER.test(plugin.version)
  ) throw new Error("invalid stable release manifest");

  return { cliVersion: cli.version, pluginVersion: plugin.version };
}

export function stableVersionStatus(
  installed: string,
  stable: string,
): "current" | "behind" | "ahead" | "prerelease" {
  if (installed === stable) return "current";
  const installedParts = STABLE_SEMVER.exec(installed)?.slice(1).map(Number);
  const stableParts = STABLE_SEMVER.exec(stable)!.slice(1).map(Number);
  if (!installedParts) return "prerelease";
  for (let index = 0; index < 3; index += 1) {
    if (installedParts[index]! < stableParts[index]!) return "behind";
    if (installedParts[index]! > stableParts[index]!) return "ahead";
  }
  return "current";
}
