/**
 * 进程内 sliding-window rate limiter（纯内存，Node 环境下轻量无外部依赖）。
 * - 基于时间戳数组：每次请求 push 一个 now，清理超出窗口的旧记录，数组长度即为当前窗口内次数
 * - 进程重启即清空；EdgeOne Pages 实例复用期间持续生效
 * - 适用场景：单节点部署的公开 API 限制（weather/saying/imgproxy/点赞）
 *
 * 注意：多实例部署时需要 Redis/D1 级别的 limiter；本工具按内存计数
 */

interface WindowStore {
  timestamps: number[];
}

const stores = new Map<string, WindowStore>();

/**
 * 检查某个 key 的请求是否超过限制。
 * @param key 限流维度（如 `weather:${ip}` 或 `like:${ip}:${momentId}`）
 * @param maxRequests 窗口内最大请求数
 * @param windowMs 时间窗口（毫秒）
 * @returns true=允许通过，false=被限流
 */
export function checkRate(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  let store = stores.get(key);
  if (!store) {
    store = { timestamps: [] };
    stores.set(key, store);
  }
  // 清理窗口外的旧时间戳
  const cutoff = now - windowMs;
  while (store.timestamps.length > 0 && store.timestamps[0] < cutoff) {
    store.timestamps.shift();
  }
  if (store.timestamps.length >= maxRequests) return false;
  store.timestamps.push(now);
  return true;
}

/** 从 Hono Context 提取客户端 IP，兼容 CF / EdgeOne / 直连 */
export function getClientIp(
  cfIp?: string,
  realIp?: string,
  remoteAddr?: string,
  fwdFor?: string,
): string {
  // x-forwarded-for 可能是 "client, proxy1, proxy2" 列表，取第一个真实 IP
  const firstFwd = fwdFor
    ? (Array.isArray(fwdFor) ? fwdFor[0] : fwdFor.split(",")[0].trim())
    : "";
  return cfIp || realIp || firstFwd || remoteAddr || "unknown";
}

/** 批量清理过期 key（内存泄漏保险，可在定时任务里调用） */
export function pruneRateKeys(maxAgeMs = 60_000): void {
  const now = Date.now();
  for (const [k, v] of stores) {
    while (v.timestamps.length > 0 && v.timestamps[0] < now - maxAgeMs) v.timestamps.shift();
    if (v.timestamps.length === 0) stores.delete(k);
  }
}
