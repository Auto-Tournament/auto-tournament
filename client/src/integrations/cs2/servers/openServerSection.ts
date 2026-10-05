/** Fired with a section id; that ServerSection opens (./ServerSection.tsx). */
export const OPEN_EVENT = 'servers-section:open';

/**
 * Open a Servers page section (remembered like a click) and scroll to it. For
 * buttons elsewhere on the page that point at a section, which may be folded.
 */
export function openServerSection(id: string) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
  // After the section has rendered open.
  window.setTimeout(
    () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    50
  );
}
