/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

// Ensure `import.meta.env` is properly typed for our custom flags
interface ImportMetaEnv {
  /**
   * When set to the string "true", forces the dev tools page to be enabled
   * even in production builds (used for review/staging).
   */
  readonly VITE_ENABLE_DEV_PAGE?: string;
}
