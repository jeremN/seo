export interface FetchResult {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  html: string;
  finalUrl: string;
}

export type FetchImpl = (url: string) => Promise<FetchResult>;

export async function fetchUrl(url: string, timeoutMs = 10000): Promise<FetchResult> {
  const attempt = async (): Promise<FetchResult> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal });
      const html = await res.text();
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
      return { ok: true, status: res.status, headers, html, finalUrl: res.url };
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    return await attempt();
  } catch {
    try {
      return await attempt(); // 1 retry
    } catch {
      return { ok: false, status: 0, headers: {}, html: '', finalUrl: url };
    }
  }
}
