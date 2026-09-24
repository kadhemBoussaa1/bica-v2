/**
 * How a form leaves once it is done. Unset, a form navigates itself
 * (`router.push` to the list or the record). The route modal
 * (`app/@modal`) sets both so the form stays on the page it was opened over:
 * `onDone` replaces the URL with the form's target, `onCancel` goes back.
 * `target` is where the form would have gone on its own.
 */
export interface FormNav {
  onDone?: (target: string) => void | Promise<void>;
  onCancel?: (target: string) => void;
}
