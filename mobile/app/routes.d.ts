// deno-lint-ignore-file
/* eslint-disable */
// biome-ignore: needed import
import type { OneRouter } from 'one'

declare module 'one' {
  export namespace OneRouter {
    export interface __routes<T extends string = string> extends Record<string, unknown> {
      StaticRoutes:
        | `/`
        | `/_sitemap`
        | `/about`
        | `/manual`
        | `/springboard`
      DynamicRoutes:
        | `/category/${OneRouter.SingleRoutePart<T>}`
        | `/dose/${OneRouter.SingleRoutePart<T>}`
        | `/player/${OneRouter.SingleRoutePart<T>}`
      DynamicRouteTemplate:
        | `/category/[category]`
        | `/dose/[id]`
        | `/player/[id]`
      IsTyped: true
      RouteTypes: {
        '/category/[category]': RouteInfo<{ category: string }>
        '/dose/[id]': RouteInfo<{ id: string }>
        '/player/[id]': RouteInfo<{ id: string }>
      }
    }
  }
}

/**
 * Helper type for route information
 */
type RouteInfo<Params = Record<string, never>> = {
  Params: Params
  LoaderProps: { path: string; search?: string; subdomain?: string; params: Params; request?: Request }
}