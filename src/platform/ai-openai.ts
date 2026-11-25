/**
 * AI 绑定的 OpenAI 兼容实现（DeepSeek / 通义千问 / vLLM 等）
 * 业务侧 ai.ts 只调用 ai.run(model, { messages, max_tokens, temperature })，
 * 并已兼容 OpenAI chat.completion 返回结构，故这里直接转发 /chat/completions。
 * 未配置 AI_BASE_URL/AI_API_KEY 时不创建实例，业务按 !env.AI 自动禁用功能。
 */
import type { AiBinding } from "../ai";

export interface OpenAiAiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class OpenAiAi implements AiBinding {
  constructor(private readonly cfg: OpenAiAiConfig) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async run(model: string, inputs: any): Promise<any> {
    // 优先使用调用方传入的模型（按次覆盖），未传则用配置默认模型
    const body: Record<string, unknown> = {
      model: model || this.cfg.model,
      messages: inputs.messages ?? [],
      max_tokens: inputs.max_tokens ?? 512,
      temperature: inputs.temperature ?? 0.7,
    };
    // 推理控制参数透传：多数 OpenAI 兼容提供商会忽略未知字段，
    // 智谱(GLM-4.5)识别 do_thinking、OpenAI/vLLM 识别 reasoning_effort / chat_template_kwargs
    if (inputs.do_thinking !== undefined) body.do_thinking = inputs.do_thinking;
    if (inputs.reasoning_effort) body.reasoning_effort = inputs.reasoning_effort;
    if (inputs.chat_template_kwargs) body.chat_template_kwargs = inputs.chat_template_kwargs;

    const res = await fetch(this.cfg.baseUrl.replace(/\/+$/, "") + "/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + this.cfg.apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`AI provider ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }
}
