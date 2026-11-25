/**
 * AI 绑定解析：优先用运行时注入的 c.env.AI（Workers 原生 AI 或 .env 启动时创建的适配器），
 * 没有则用后台设置中的 ai_base_url / ai_api_key / ai_model 临时构造 OpenAI 兼容适配器。
 * 都不可用时返回 undefined，调用方按「AI 未配置」禁用功能。
 */
import type { Context } from "hono";
import type { HonoEnv } from "./types";
import type { SiteSettings } from "./settings";
import type { AiBinding } from "./ai";
import { OpenAiAi } from "./platform/ai-openai";

export function resolveAi(c: Context<HonoEnv>, s: SiteSettings): AiBinding | undefined {
  if (c.env.AI) return c.env.AI;
  const base = (s.ai_base_url || "").trim();
  const key = (s.ai_api_key || "").trim();
  const model = (s.ai_model || "").trim();
  if (base && key && model) {
    return new OpenAiAi({ baseUrl: base, apiKey: key, model });
  }
  return undefined;
}
