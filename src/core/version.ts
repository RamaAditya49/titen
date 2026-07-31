import packageJson from "../../package.json" with { type: "json" };

/** Published implementation version. Deployment revisions remain separate. */
export const TITEN_VERSION = packageJson.version;
