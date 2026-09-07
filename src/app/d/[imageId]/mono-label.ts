/**
 * The mono label used across the image detail page for section and row
 * labels (Paper slice 5, #188). Defined once here — in a module with no
 * component imports — so the client components that need the class string
 * do not pull a server component (and its server-action imports) into their
 * bundle or their tests.
 */
export const MONO_LABEL =
  "font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted";
