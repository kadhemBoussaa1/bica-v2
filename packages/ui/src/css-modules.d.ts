/**
 * CSS module declarations. Inside apps/web these come from next-env.d.ts, but
 * this package is type-checked on its own, so it declares them itself.
 */
declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}
