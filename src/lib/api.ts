/** Shared public API boundary. Never expose database/driver errors to clients. */
export class ApiError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function productId(value: unknown): number {
  if ((typeof value !== "number" && typeof value !== "string") || !/^\d+$/.test(String(value))) throw new ApiError("شناسه محصول نامعتبر است");
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) throw new ApiError("شناسه محصول نامعتبر است");
  return id;
}
export function configVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 2147483647) {
    throw new ApiError("نسخه پیکربندی نامعتبر است");
  }
  return value;
}

/**
 * Reject browser cross-site mutations. This is CSRF defence, NOT authentication or authorization.
 * Forwarded host/protocol support HTTPS previews behind a trusted reverse proxy; that proxy must
 * replace (not append untrusted) forwarding headers. CLI/server clients may omit Origin.
 */
export function assertSameOrigin(req: Request): void {
  if (req.headers.get("sec-fetch-site") === "cross-site") throw new ApiError("درخواست بین‌سایتی مجاز نیست", 403);
  const origin = req.headers.get("origin");
  if (!origin) return;
  const requestUrl = new URL(req.url);
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? requestUrl.host).split(",")[0].trim();
  const protocol = (req.headers.get("x-forwarded-proto") ?? requestUrl.protocol.replace(":", "")).split(",")[0].trim();
  let allowed = false;
  try {
    const supplied = new URL(origin);
    allowed = ["http:", "https:"].includes(supplied.protocol) && supplied.origin === new URL(`${protocol}://${host}`).origin;
  } catch { /* malformed or opaque Origin (e.g. null) is not a trusted browser */ }
  if (!allowed) throw new ApiError("مبدأ درخواست مجاز نیست", 403);
}

/** Reads a bounded (64 KB), same-origin application/json object body. */
export async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  assertSameOrigin(req);
  const contentType = req.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new ApiError("نوع محتوا باید application/json باشد", 415);
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError("بدنه درخواست الزامی است");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) { await reader.cancel(); throw new ApiError("حجم درخواست بیش از حد مجاز است", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ApiError("ساختار JSON نامعتبر است"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError("بدنه درخواست باید یک شیء باشد");
  return body as Record<string, unknown>;
}
export async function readBody(req: Request, requireConfig = false): Promise<Record<string, unknown>> {
  const body = await readJsonObject(req);
  const b = body as Record<string, unknown>;
  if (b.productId !== undefined) productId(b.productId);
  if (b.config !== undefined && (!b.config || typeof b.config !== "object" || Array.isArray(b.config))) throw new ApiError("پیکربندی نامعتبر است");
  if (requireConfig && b.config === undefined) throw new ApiError("پیکربندی محصول الزامی است");
  if (b.productId !== undefined && b.config !== undefined) throw new ApiError("فقط یکی از پیکربندی یا شناسه محصول را ارسال کنید");
  if (b.productId === undefined && b.config === undefined) throw new ApiError("پیکربندی یا شناسه محصول الزامی است");
  return b;
}
export function apiFailure(error: unknown): Response {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
  console.error("API request failed", error);
  return Response.json({ error: "انجام درخواست ممکن نشد؛ دوباره تلاش کنید." }, { status: 500 });
}
