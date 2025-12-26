/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

// Ensure `import.meta.env` is properly typed for our custom flags
interface ImportMetaEnv {
  readonly DEV?: boolean | string;
  readonly VITE_ENABLE_DEV_PAGE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
