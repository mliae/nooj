/** 全局绑定与通用响应类型 */

import type { AiBinding } from "./ai";
import type { SiteSettings } from "./settings";

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  ASSETS: Fetcher;
  /** AI 绑定（评论 @AI 回复；Node 下为 OpenAI 兼容适配器） */
  AI: AiBinding;
  /** 站主解锁密码（.env 配置） */
  ADMIN_PASSWORD: string;
  SITE_NAME: string;
}

export type HonoEnv = {
  Bindings: Env;
  /** 请求级共享变量（中间件读一次设置，供后续中间件复用） */
  Variables: { siteSettings?: SiteSettings };
};

export interface OkResponse<T> {
  code: 200;
  message: string;
  data: T;
}

export interface FailResponse {
  code: number;
  message: string;
  data: null;
}
