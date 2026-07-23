// Dev hooks are also available in explicit QA snapshot builds. Normal
// production builds omit VITE_M1_QA and therefore expose no QA globals.
const env = (
  import.meta as unknown as { env?: { DEV?: boolean; VITE_M1_QA?: string } }
).env;
export const QA_RUNTIME_ENABLED =
  Boolean(env?.DEV) || env?.VITE_M1_QA === "1";
