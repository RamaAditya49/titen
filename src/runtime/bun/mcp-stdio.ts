type JsonRpcId = string | number | null;

type StdioOptions = {
  endpoint?: string;
  apiKey?: string;
  input?: AsyncIterable<Uint8Array>;
  fetcher?: typeof fetch;
  write?: (line: string) => void;
};

function requestId(message: unknown): JsonRpcId | undefined {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  if (!Object.hasOwn(message, "id")) return undefined;
  const id = (message as { id?: unknown }).id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function failure(id: JsonRpcId, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

function endpointFrom(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("TITEN_MCP_URL must be a valid HTTP /mcp endpoint");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith("/mcp")
  ) throw new Error("TITEN_MCP_URL must be a credential-free HTTP /mcp endpoint");
  return url;
}

/** Adapts MCP's newline-delimited stdio transport to Titen's existing HTTP endpoint. */
export async function runMcpStdio(options: StdioOptions = {}): Promise<void> {
  const rawEndpoint = options.endpoint ?? process.env.TITEN_MCP_URL;
  const apiKey = options.apiKey ?? process.env.TITEN_API_KEY;
  if (!rawEndpoint || !apiKey) throw new Error("TITEN_MCP_URL and TITEN_API_KEY are required");
  if (apiKey !== apiKey.trim() || /[\r\n]/u.test(apiKey))
    throw new Error("TITEN_API_KEY is invalid");

  const endpoint = endpointFrom(rawEndpoint);
  const fetcher = options.fetcher ?? fetch;
  const write = options.write ?? ((line: string) => console.log(line));
  const input = options.input ?? (Bun.stdin.stream() as AsyncIterable<Uint8Array>);
  const decoder = new TextDecoder();
  let pending = "";
  let protocolVersion: string | undefined;

  const forward = async (line: string) => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      write(failure(null, -32700, "Parse error."));
      return;
    }
    const id = requestId(message);
    try {
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          ...(protocolVersion ? { "mcp-protocol-version": protocolVersion } : {}),
        },
        body: line,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await response.text()).replaceAll(apiKey, "[redacted]");
      if (id === undefined || body === "") return;
      const parsed = JSON.parse(body) as {
        jsonrpc?: unknown;
        result?: { protocolVersion?: unknown };
      };
      if (parsed.jsonrpc !== "2.0") throw new Error("invalid upstream response");
      if (
        (message as { method?: unknown }).method === "initialize" &&
        typeof parsed.result?.protocolVersion === "string"
      ) protocolVersion = parsed.result.protocolVersion;
      write(body);
    } catch {
      if (id !== undefined) write(failure(id, -32000, "Titen MCP request failed."));
    }
  };

  for await (const chunk of input) {
    pending += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, newline).replace(/\r$/u, "");
      pending = pending.slice(newline + 1);
      if (line.trim()) await forward(line);
    }
  }
  pending += decoder.decode();
  if (pending.trim()) await forward(pending.replace(/\r$/u, ""));
}
