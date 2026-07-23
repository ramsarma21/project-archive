// Dev hooks are also available in explicit QA snapshot builds. Normal
// production builds omit VITE_M1_QA and therefore expose no QA globals.
export const QA_RUNTIME_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_M1_QA === "1";
