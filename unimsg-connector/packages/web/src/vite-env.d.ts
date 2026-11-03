/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 后端 API 基地址（如 http://127.0.0.1:3001）；留空则使用 Mock 演示模式 */
  readonly VITE_API_BASE?: string;
  /** 业务接口 Bearer Token，需与后端 API_TOKEN 一致（演示默认 dev-token） */
  readonly VITE_API_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
