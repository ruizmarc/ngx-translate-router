import { Routes, Route, NavigationExtras, Params } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom, Observable, Observer } from 'rxjs';
import { isPlatformBrowser, Location } from '@angular/common';
import { CacheMechanism, LocalizeRouterSettings } from './localize-router.config';
import { DOCUMENT, inject, Inject, Injectable, PLATFORM_ID, REQUEST } from '@angular/core';
import { HttpParams } from '@angular/common/http';

const COOKIE_EXPIRY = 30; // 1 month

/**
 * Abstract class for parsing localization
 */
@Injectable()
export abstract class LocalizeParser {
  locales: Array<string>;
  currentLang: string;
  routes: Routes;
  defaultLang: string;

  protected prefix: string;
  protected escapePrefix: string;

  private _translationObject: any;
  private _wildcardRoute: Route;
  private _languageRoute: Route;

  private request = inject(REQUEST);
  private document = inject(DOCUMENT);
  private platformId = inject(PLATFORM_ID);

  /**
   * Loader constructor
   */
  constructor(
    @Inject(TranslateService) private translate: TranslateService,
    @Inject(Location) private location: Location,
    @Inject(LocalizeRouterSettings) private settings: LocalizeRouterSettings
  ) {
  }

  /**
   * Load routes and fetch necessary data
   */
  abstract load(routes: Routes): Promise<any>;

  /**
   * Initialize language and routes
   */
  protected init(routes: Routes): Promise<any> {
    let selectedLanguage: string;

    this.routes = routes;

    if (!this.locales || !this.locales.length) {
      return Promise.resolve();
    }
    /** detect current language */
    const locationLang = this.getLocationLang();
    const browserLang = this._getBrowserLang();

    if (this.settings.defaultLangFunction) {
      this.defaultLang = this.settings.defaultLangFunction(this.locales, this._cachedLang, browserLang);
    } else {
      this.defaultLang = this._cachedLang || browserLang || this.locales[0];
    }

    selectedLanguage = locationLang || this.defaultLang;
    this.translate.setDefaultLang(this.defaultLang);

    let children: Routes = [];
    /** if set prefix is enforced */
    if (this.settings.alwaysSetPrefix) {
      const baseRoute: Route = { path: '', redirectTo: this.defaultLang, pathMatch: 'full' };

      /** extract potential wildcard route */
      const wildcardIndex = routes.findIndex((route: Route) => route.path === '**');
      if (wildcardIndex !== -1) {
        this._wildcardRoute = routes.splice(wildcardIndex, 1)[0];
      }
      children = this.routes.splice(0, this.routes.length, baseRoute);
    } else {
      children = [...this.routes]; // shallow copy of routes
    }

    /** exclude certain routes */
    for (let i = children.length - 1; i >= 0; i--) {
      if (children[i].data && children[i].data['skipRouteLocalization']) {
        if (this.settings.alwaysSetPrefix) {
          // add directly to routes
          this.routes.push(children[i]);
        }
        // remove from routes to translate only if doesn't have to translate `redirectTo` property
        if (children[i].redirectTo === undefined || !(children[i].data['skipRouteLocalization']['localizeRedirectTo']) || typeof children[i].redirectTo === 'function') {
          children.splice(i, 1);
        }
      }
    }

    /** append children routes */
    if (children && children.length) {
      if (this.locales.length > 1 || this.settings.alwaysSetPrefix) {
        this._languageRoute = { children: children };
        this.routes.unshift(this._languageRoute);
      }
    }

    /** ...and potential wildcard route */
    if (this._wildcardRoute && this.settings.alwaysSetPrefix) {
      this.routes.push(this._wildcardRoute);
    }

    /** translate routes */
    return firstValueFrom(
      this.translateRoutes(selectedLanguage)
    );
  }

  initChildRoutes(routes: Routes) {
    this._translateRouteTree(routes);
    return routes;
  }

  /**
   * Translate routes to selected language
   */
  translateRoutes(language: string): Observable<any> {
    return new Observable<any>((observer: Observer<any>) => {
      this._cachedLang = language;
      if (this._languageRoute) {
        this._languageRoute.path = language;
      }
      this.translate.use(language).subscribe((translations: any) => {
        this._translationObject = translations;
        this.currentLang = language;

        if (this._languageRoute) {
          this._translateRouteTree(this._languageRoute.children, true);
          // if there is wildcard route
          if (this._wildcardRoute && this._wildcardRoute.redirectTo) {
            this._translateProperty(this._wildcardRoute, 'redirectTo', true);
          }
        } else {
          this._translateRouteTree(this.routes, true);
        }

        observer.next(void 0);
        observer.complete();
      });
    });
  }

  /**
   * Translate the route node and recursively call for all it's children
   */
  private _translateRouteTree(routes: Routes, isRootTree?: boolean): void {
    routes.forEach((route: Route) => {
      const skipRouteLocalization = (route.data && route.data['skipRouteLocalization']);
      const localizeRedirection = !skipRouteLocalization || skipRouteLocalization['localizeRedirectTo'];

      if (route.redirectTo && localizeRedirection && !(typeof route.redirectTo === 'function')) {
        const prefixLang = route.redirectTo.indexOf('/') === 0 || isRootTree;
        this._translateProperty(route, 'redirectTo', prefixLang);
      }

      if (skipRouteLocalization) {
        return;
      }

      if (route.path !== null && route.path !== undefined/* && route.path !== '**'*/) {
        this._translateProperty(route, 'path');
      }
      if (route.children) {
        this._translateRouteTree(route.children);
      }
      console.log('route', route.loadChildren, route['_loadedRoutes']);
      if (route.loadChildren && (<any>route)._loadedRoutes?.length) {
        this._translateRouteTree((<any>route)._loadedRoutes);
      }
    });
  }

  /**
   * Translate property
   * If first time translation then add original to route data object
   */
  private _translateProperty(route: Route, property: string, prefixLang?: boolean): void {
    // set property to data if not there yet
    const routeData: any = route.data = route.data || {};
    if (!routeData.localizeRouter) {
      routeData.localizeRouter = {};
    }
    if (!routeData.localizeRouter[property]) {
      routeData.localizeRouter = { ...routeData.localizeRouter, [property]: route[property] };
    }

    const result = this.translateRoute(routeData.localizeRouter[property]);
    (<any>route)[property] = prefixLang ? this.addPrefixToUrl(result) : result;
  }

  get urlPrefix() {
    if (this.settings.alwaysSetPrefix || this.currentLang !== this.defaultLang) {
      return this.currentLang ? this.currentLang : this.defaultLang;
    } else {
      return '';
    }
  }

  /**
   * Add current lang as prefix to given url.
   */
  addPrefixToUrl(url: string): string {
    const splitUrl = url.split('?');
    const isRootPath = splitUrl[0].length === 1 && splitUrl[0] === '/';
    splitUrl[0] = splitUrl[0].replace(/\/$/, '');

    const joinedUrl = splitUrl.join('?');
    if (this.urlPrefix === '') {
      return joinedUrl;
    }

    if (!joinedUrl.startsWith('/') && !isRootPath) {
      return `${this.urlPrefix}/${joinedUrl}`;
    }
    return `/${this.urlPrefix}${joinedUrl}`;
  }

  /**
   * Translate route and return observable
   */
  translateRoute(path: string): string {
    const queryParts = path.split('?');
    if (queryParts.length > 2) {
      throw Error('There should be only one query parameter block in the URL');
    }
    const pathSegments = queryParts[0].split('/');

    /** collect observables  */
    return pathSegments
      .map((part: string) => part.length ? this.translateText(part) : part)
      .join('/') +
      (queryParts.length > 1 ? `?${queryParts[1]}` : '');
  }

  /**
   * Get language from url
   */
  getLocationLang(url?: string): string {
    const queryParamSplit = (url || this.location.path()).split(/[\?;]/);
    let pathSlices: string[] = [];
    if (queryParamSplit.length > 0) {
      pathSlices = queryParamSplit[0].split('/');
    }
    if (pathSlices.length > 1 && this.locales.indexOf(pathSlices[1]) !== -1) {
      return pathSlices[1];
    }
    if (pathSlices.length && this.locales.indexOf(pathSlices[0]) !== -1) {
      return pathSlices[0];
    }
    return null;
  }

  /**
   * Get user's language set in the browser
   */
  private _getBrowserLang(): string {
    return this._returnIfInLocales(this.translate.getBrowserLang());
  }

  /**
   * Get language from local storage or cookie
   */
  private get _cachedLang(): string {
    if (!this.settings.useCachedLang) {
      return;
    }
    if (this.settings.cacheMechanism === CacheMechanism.LocalStorage) {
      return this._cacheWithLocalStorage();
    }
    if (this.settings.cacheMechanism === CacheMechanism.SessionStorage) {
      return this._cacheWithSessionStorage();
    }
    if (this.settings.cacheMechanism === CacheMechanism.Cookie) {
      return this._getCookieValue();
    }
  }

  /**
   * Save language to local storage or cookie
   */
  private set _cachedLang(value: string) {
    if (!this.settings.useCachedLang) {
      return;
    }
    if (this.settings.cacheMechanism === CacheMechanism.LocalStorage) {
      this._cacheWithLocalStorage(value);
    }
    if (this.settings.cacheMechanism === CacheMechanism.SessionStorage) {
      this._cacheWithSessionStorage(value);
    }
    if (this.settings.cacheMechanism === CacheMechanism.Cookie) {
      this._setCookieValue(value);
    }
  }

  /**
   * Cache value to local storage
   */
  private _cacheWithLocalStorage(value?: string): string {
    try {
      if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
        return;
      }
      if (value) {
        window.localStorage.setItem(this.settings.cacheName, value);
        return;
      }
      return this._returnIfInLocales(window.localStorage.getItem(this.settings.cacheName));
    } catch (e) {
      // weird Safari issue in private mode, where LocalStorage is defined but throws error on access
      return;
    }
  }

  /**
   * Cache value to session storage
   */
  private _cacheWithSessionStorage(value?: string): string {
    try {
      if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') {
        return;
      }
      if (value) {
        window.sessionStorage.setItem(this.settings.cacheName, value);
        return;
      }
      return this._returnIfInLocales(window.sessionStorage.getItem(this.settings.cacheName));
    } catch (e) {
      return;
    }
  }

  /**
   * Cache value via cookies
   */
  private _setCookieValue(value: string): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const name = encodeURIComponent(this.settings.cacheName);
    const cookieString = (this.settings.cookieFormat ?? '')
      .replace('{{value}}', `${name}=${encodeURIComponent(value)}`)
      .replace(/{{expires:?(\d+)?}}/g, (fullMatch, groupMatch) => {
        const days = groupMatch === undefined ? COOKIE_EXPIRY : parseInt(groupMatch, 10);
        const date: Date = new Date();
        date.setTime(date.getTime() + days * 86400000);
        return `expires=${date.toUTCString()}`;
      });
    this.document.cookie = cookieString;
  }

  private _getCookieValue(): string {
    const name = encodeURIComponent(this.settings.cacheName);
    const regexp = new RegExp('(?:^' + name + '|;\\s*' + name + ')=(.*?)(?:;|$)', 'g');
    const cookie = isPlatformBrowser(this.platformId) ? this.document.cookie : this.request?.headers.get('cookie') ?? '';
    const result = regexp.exec(cookie);
    return result ? decodeURIComponent(result[1]) : null;
  }

  /**
   * Check if value exists in locales list
   */
  private _returnIfInLocales(value: string): string {
    if (value && this.locales.indexOf(value) !== -1) {
      return value;
    }
    return null;
  }

  /**
   * Get translated value
   */
  private translateText(key: string): string {
    if (this.escapePrefix && key.startsWith(this.escapePrefix)) {
      return key.replace(this.escapePrefix, '');
    } else {
      if (!this._translationObject) {
        return key;
      }
      const fullKey = this.prefix + key;
      const res = this.translate.getParsedResult(this._translationObject, fullKey);
      return res !== fullKey ? res : key;
    }
  }

  /**
   * Strategy to choose between new or old queryParams
   * @param newExtras extras that containes new QueryParams
   * @param currentQueryParams current query params
   */
  public chooseQueryParams(newExtras: NavigationExtras, currentQueryParams: Params) {
    let queryParamsObj: Params;
    if (newExtras && newExtras.queryParams) {
      queryParamsObj = newExtras.queryParams;
    } else if (currentQueryParams) {
      queryParamsObj = currentQueryParams;
    }
    return queryParamsObj;
  }

  /**
   * Format query params from object to string.
   * Exemple of result: `param=value&param2=value2`
   * @param params query params object
   */
  public formatQueryParams(params: Params): string {
    return new HttpParams({ fromObject: params }).toString();
  }

  /**
   * Get translation key prefix from config
   */
  public getPrefix(): string {
    return this.prefix;
  }

  /**
   * Get escape translation prefix from config
   */
  public getEscapePrefix(): string {
    return this.escapePrefix;
  }
}

/**
 * Manually set configuration
 */
export class ManualParserLoader extends LocalizeParser {

  /**
   * CTOR
   */
  constructor(translate: TranslateService, location: Location, settings: LocalizeRouterSettings,
    locales: string[] = ['en'], prefix: string = 'ROUTES.', escapePrefix: string = '') {
    super(translate, location, settings);
    this.locales = locales;
    this.prefix = prefix || '';
    this.escapePrefix = escapePrefix || '';
  }

  /**
   * Initialize or append routes
   */
  load(routes: Routes): Promise<any> {
    return new Promise((resolve: any) => {
      this.init(routes).then(resolve);
    });
  }
}

@Injectable()
export class DummyLocalizeParser extends LocalizeParser {
  load(routes: Routes): Promise<any> {
    return new Promise((resolve: any) => {
      this.init(routes).then(resolve);
    });
  }
}
