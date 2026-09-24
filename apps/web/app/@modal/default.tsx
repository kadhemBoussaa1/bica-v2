/**
 * The modal slot's resting state: nothing. Rendered whenever the URL does not
 * match an intercepted route — every ordinary page, and a hard load of a
 * `/new` URL, which then renders its full page instead.
 */
export default function ModalDefault() {
  return null;
}
