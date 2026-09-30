/**
 * Motion states of the finish layer (R-028, styles.css "Motion and finish").
 *
 * - "waiting": a 2 px orbiting ring while HanMark works on something the user is
 *   waiting for (export, import, preview render, DOCX build).
 * - "done": a short check after a save.
 *
 * Only a class and a data attribute change; styles.css draws everything and turns all
 * movement off under `prefers-reduced-motion`.
 */
export type MotionPhase = "waiting" | "done";

export function setPhase(element: HTMLElement, phase: MotionPhase | null): void {
  element.addClass("hanmark-orbit-host");
  if (phase) element.setAttribute("data-phase", phase);
  else element.removeAttribute("data-phase");
}

/** Shows the "done" state for `ms`, unless something else changed the phase meanwhile. */
export function flashDone(element: HTMLElement, ms = 1200): void {
  setPhase(element, "done");
  (element.win ?? window).setTimeout(() => {
    if (element.getAttribute("data-phase") === "done") setPhase(element, null);
  }, ms);
}
