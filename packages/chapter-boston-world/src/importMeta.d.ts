interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly VITE_M1_QA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
