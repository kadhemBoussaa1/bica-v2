# Turborepo starter

This Turborepo starter is maintained by the Turborepo core team.

## Using this example

Run the following command:

```sh
npx create-turbo@latest
```

## What's inside?

This Turborepo includes the following packages/apps:

### Apps and Packages

- `api`: a [NestJS](https://nestjs.com/) backend serving [tRPC](https://trpc.io/) at `/trpc`, with [Prisma](https://www.prisma.io/) as the ORM
- `web`: another [Next.js](https://nextjs.org/) app
- `@repo/api-contract`: [Zod](https://zod.dev/) schemas shared by `api` and `web`
- `@repo/ui`: a stub React component library shared by the `web` application
- `@repo/eslint-config`: `eslint` configurations (includes `@next/eslint-plugin-next` and `eslint-config-prettier`)
- `@repo/typescript-config`: `tsconfig.json`s used throughout the monorepo

Each package/app is 100% [TypeScript](https://www.typescriptlang.org/).

### Utilities

This Turborepo has some additional tools already setup for you:

- [TypeScript](https://www.typescriptlang.org/) for static type checking
- [ESLint](https://eslint.org/) for code linting
- [Prettier](https://prettier.io) for code formatting

### Build

To build all apps and packages, run the following command:

With [global `turbo`](https://turborepo.dev/docs/getting-started/installation#global-installation) installed (recommended):

```sh
cd my-turborepo
turbo build
```

Without global `turbo`, use your package manager:

```sh
cd my-turborepo
npx turbo build
pnpm exec turbo build
pnpm exec turbo build
```

You can build a specific package by using a [filter](https://turborepo.dev/docs/crafting-your-repository/running-tasks#using-filters):

With [global `turbo`](https://turborepo.dev/docs/getting-started/installation#global-installation) installed:

```sh
turbo build --filter=api
```

Without global `turbo`:

```sh
npx turbo build --filter=api
pnpm exec turbo build --filter=api
pnpm exec turbo build --filter=api
```

### Develop

To develop all apps and packages, run the following command:

With [global `turbo`](https://turborepo.dev/docs/getting-started/installation#global-installation) installed (recommended):

```sh
cd my-turborepo
turbo dev
```

Without global `turbo`, use your package manager:

```sh
cd my-turborepo
npx turbo dev
pnpm exec turbo dev
pnpm exec turbo dev
```

You can develop a specific package by using a [filter](https://turborepo.dev/docs/crafting-your-repository/running-tasks#using-filters):

With [global `turbo`](https://turborepo.dev/docs/getting-started/installation#global-installation) installed:

```sh
turbo dev --filter=web
```

Without global `turbo`:

```sh
npx turbo dev --filter=web
pnpm exec turbo dev --filter=web
pnpm exec turbo dev --filter=web
```

### Remote Caching

> [!TIP]
> Vercel Remote Cache is free for all plans. Get started today at [vercel.com](https://vercel.com/signup?utm_source=remote-cache-sdk&utm_campaign=free_remote_cache).

Turborepo can use a technique known as [Remote Caching](https://turborepo.dev/docs/core-concepts/remote-caching) to share cache artifacts across machines, enabling you to share build caches with your team and CI/CD pipelines.

By default, Turborepo will cache locally. To enable Remote Caching you will need an account with Vercel. If you don't have an account you can [create one](https://vercel.com/signup?utm_source=turborepo-examples), then enter the following commands:

With [global `turbo`](https://turborepo.dev/docs/getting-started/installation#global-installation) installed (recommended):

```sh
cd my-turborepo
turbo login
```

Without global `turbo`, use your package manager:

```sh
cd my-turborepo
npx turbo login
pnpm exec turbo login
pnpm exec turbo login
```

This will authenticate the Turborepo CLI with your [Vercel account](https://vercel.com/docs/concepts/personal-accounts/overview).

Next, you can link your Turborepo to your Remote Cache by running the following command from the root of your Turborepo:

With [global `turbo`](https://turborepo.dev/docs/getting-started/installation#global-installation) installed:

```sh
turbo link
```

Without global `turbo`:

```sh
npx turbo link
pnpm exec turbo link
pnpm exec turbo link
```

## Useful Links

Learn more about the power of Turborepo:

- [Tasks](https://turborepo.dev/docs/crafting-your-repository/running-tasks)
- [Caching](https://turborepo.dev/docs/crafting-your-repository/caching)
- [Remote Caching](https://turborepo.dev/docs/core-concepts/remote-caching)
- [Filtering](https://turborepo.dev/docs/crafting-your-repository/running-tasks#using-filters)
- [Configuration Options](https://turborepo.dev/docs/reference/configuration)
- [CLI Usage](https://turborepo.dev/docs/reference/command-line-reference)

### First-time setup

Start Postgres and apply migrations:

```sh
docker compose up -d          # Postgres on host port 5433
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm --filter api db:migrate  # generates the client and applies migrations
```

> Host port **5433** is used to avoid colliding with a local Postgres already on 5432.

Then `pnpm dev` runs `web` on :3000 and `api` on :3001.

Prisma commands (all in `apps/api`):

| Command | Purpose |
| --- | --- |
| `pnpm --filter api db:generate` | Regenerate the Prisma client |
| `pnpm --filter api db:migrate` | Create + apply a migration in dev |
| `pnpm --filter api db:deploy` | Apply migrations in CI/production |
| `pnpm --filter api db:studio` | Browse data in Prisma Studio |

### Roles and permissions

Strict hierarchy, defined in `packages/api-contract/src/roles.ts`:

```
SUPER_ADMIN (100)  >  ADMIN (75)  >  PRODUCTION (50) == MAGASINIER (50)
```

PRODUCTION and MAGASINIER are **siblings** — equal rank, so neither inherits the
other. ADMIN and SUPER_ADMIN inherit everything below them.

| Rule | Function | Behaviour |
| --- | --- | --- |
| Feature access | `canAccess(role, required)` | Higher rank passes; at equal rank the role must match exactly (sibling isolation) |
| Account creation | `canCreateRole(actor, target)` | Strictly **below** the actor's rank — blocks escalation *and* lateral expansion |
| Managing a user | `canManageUser(actor, target)` | Strictly below; you also cannot act on your own account |

Who may create whom:

| Actor | May create |
| --- | --- |
| SUPER_ADMIN | ADMIN, PRODUCTION, MAGASINIER |
| ADMIN | PRODUCTION, MAGASINIER |
| PRODUCTION / MAGASINIER | nobody |

There is **no self-registration**. The first SUPER_ADMIN comes from the seed
script; every other account is created by someone ranked above it.

```sh
pnpm --filter api db:seed   # creates SUPER_ADMIN from SUPER_ADMIN_* env vars
```

Procedure helpers in `apps/api/src/trpc/trpc.ts`:

- `publicProcedure` — no auth
- `protectedProcedure` — signed in and not banned; narrows `ctx.user` to non-null
- `roleProcedure(role)` / `adminProcedure` / `superAdminProcedure` — role-gated

Row-level ownership is enforced separately in the services (e.g. non-admins see
only their own posts), because a role check alone cannot answer "is this *their*
record?".


### Adding an endpoint

1. Add/extend a Zod schema in `packages/api-contract/src/schemas.ts`
2. Add the business logic to a service in `apps/api/src/`
3. Add the procedure to `apps/api/src/trpc/trpc.router.ts`, choosing the right
   procedure base (`protectedProcedure`, `adminProcedure`, …)
4. Call it from `web` with `useTRPC()` — the types flow through automatically

