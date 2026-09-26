/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AI_WEBHOOK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
