import { Router, LoadChildren, ROUTES, Route, DefaultExport, Routes, PRIMARY_OUTLET } from '@angular/router';
import { Injector, Compiler, NgModuleFactory, PLATFORM_ID, inject, Injectable, EnvironmentInjector } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { from, of, isObservable, Observable, ConnectableObservable, Subject } from 'rxjs';
import { mergeMap, map, refCount, finalize } from 'rxjs/operators';
import { isPromise } from './util';
import { LocalizeParser } from './localize-router.parser';
import { EmptyOutletComponent } from './empty_outlet';

@Injectable({providedIn: 'root'})
export class LocalizedRouter extends Router {

  private platformId = inject(PLATFORM_ID);
  private compiler = inject(Compiler);
  private localize = inject(LocalizeParser);
  private childrenLoaders = new WeakMap<Route, Observable<LoadedRouterConfig>>();
  onLoadStartListener?: (r: Route) => void;
  onLoadEndListener?: (r: Route) => void;
  constructor() {
    super();
    // Custom configuration
    const isBrowser = isPlatformBrowser(this.platformId);
    // __proto__ is needed for preloaded modules be doesn't work with SSR
    // @ts-ignore
    const configLoader = isBrowser
      ? (this as any).navigationTransitions.configLoader.__proto__
      : (this as any).navigationTransitions.configLoader;

    configLoader.loadChildren = (parentInjector: Injector, route: any) => {
      if (this.childrenLoaders.get(route)) {
        return this.childrenLoaders.get(route)!;
      } else if (route._loadedRoutes) {
        return of({routes: route._loadedRoutes, injector: route._loadedInjector});
      }
  
      if (this.onLoadStartListener) {
        this.onLoadStartListener(route);
      }
      const moduleFactoryOrRoutes$ =
      this.loadModuleFactoryOrRoutes(parentInjector, route);
      const loadRunner = moduleFactoryOrRoutes$.pipe(
          finalize(() => {  
            this.childrenLoaders.delete(route);
          }),
      );
      const loader = new ConnectableObservable(loadRunner, () => new Subject<any>())
                         .pipe(refCount());
      this.childrenLoaders.set(route, loader);
      return loader;      
   }
  }
  
  loadModuleFactoryOrRoutes = (parentInjector: Injector, route: Route) => {
    return wrapIntoObservable(route.loadChildren!())
    .pipe(
        map(maybeUnwrapDefaultExport),
        mergeMap((t) => {
          if (t instanceof NgModuleFactory || Array.isArray(t)) {
            return of(t);
          } else {
            return from(this.compiler.compileModuleAsync(t));
          }
        }),
        map((factoryOrRoutes: NgModuleFactory<any>|Routes) => {
          if (this.onLoadEndListener) {
            this.onLoadEndListener(route);
          }
          let injector: EnvironmentInjector|undefined;
          let rawRoutes: Route[];
          if (Array.isArray(factoryOrRoutes)) {
            rawRoutes = factoryOrRoutes;
          } else {
            injector = factoryOrRoutes.create(parentInjector).injector;
            const getMethod = injector.get.bind(injector);
            injector['get'] = (token: any, notFoundValue: any, flags?: any) => {
              const getResult = getMethod(token, notFoundValue, flags);
              if (token === ROUTES) {
                return this.localize.initChildRoutes([].concat(...getResult));
              } else {
                return getResult;
              }
            };
            rawRoutes = injector.get(ROUTES, [], {optional: true, self: true}).reduce((acc, routes) => acc.concat(routes), []);
          }
          const routes = rawRoutes.map(standardizeConfig);
          return {routes, injector};
        }),
    );
  };
}


 
export function standardizeConfig(r: Route): Route {
  const children = r.children && r.children.map(standardizeConfig);
  const c = children ? {...r, children} : {...r};
  if ((!c.component && !c.loadComponent) && (children || c.loadChildren) &&
      (c.outlet && c.outlet !== PRIMARY_OUTLET)) {
    c.component = EmptyOutletComponent;
  }
  return c;
}
export interface LoadedRouterConfig {
  routes: Route[];
  injector: EnvironmentInjector|undefined;
}

function isWrappedDefaultExport<T>(value: T|DefaultExport<T>): value is DefaultExport<T> {
  // We use `in` here with a string key `'default'`, because we expect `DefaultExport` objects to be
  // dynamically imported ES modules with a spec-mandated `default` key. Thus we don't expect that
  // `default` will be a renamed property.
  return value && typeof value === 'object' && 'default' in value;
}

function maybeUnwrapDefaultExport<T>(input: T|DefaultExport<T>): T {
  // As per `isWrappedDefaultExport`, the `default` key here is generated by the browser and not
  // subject to property renaming, so we reference it with bracket access.
  return isWrappedDefaultExport(input) ? input['default'] : input;
}

export function wrapIntoObservable<T>(value: T | NgModuleFactory<T> | Promise<T> | Observable<T>) {
  if (isObservable(value)) {
    return value;
  }

  if (isPromise(value)) {
    // Use `Promise.resolve()` to wrap promise-like instances.
    // Required ie when a Resolver returns a AngularJS `$q` promise to correctly trigger the
    // change detection.
    return from(Promise.resolve(value));
  }

  return of(value);
}