export interface PublicInfo {
  ip: string;
  asn: string;
  org: string;
  country: string;
  country_code: string;
  city: string;
}

export const PUBLIC_URL = "https://ip.zet.tw/json";

const FIELDS = ["ip", "asn", "org", "country", "country_code", "city"] as const;

/** The real endpoint answers in well under 1 KB; anything larger is not the endpoint we asked for. */
const MAX_BODY = 64 * 1024;

export async function fetchPublicInfo(
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<PublicInfo> {
  const { timeoutMs = 5000, fetchImpl = fetch } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`ip.zet.tw timed out after ${timeoutMs} ms`)), timeoutMs);
  try {
    const res = await fetchImpl(PUBLIC_URL, {
      signal: controller.signal,
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ip.zet.tw`);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BODY) throw new Error("malformed response: too large");
    const text = await res.text();
    if (text.length > MAX_BODY) throw new Error("malformed response: too large");
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(`malformed response: not JSON`);
      }
      throw err;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error(`malformed response: not an object`);
    }
    const ip = data.ip;
    if (typeof ip !== "string") {
      throw new Error(`malformed response: missing or invalid ip`);
    }
    const info = { ip } as Record<(typeof FIELDS)[number], string>;
    for (const key of FIELDS) {
      if (key === "ip") continue;
      const v = data[key];
      info[key] = typeof v === "string" ? v : "";
    }
    return info;
  } finally {
    clearTimeout(timer);
  }
}
