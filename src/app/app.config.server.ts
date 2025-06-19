import { provideServerRendering, RenderMode, withRoutes } from '@angular/ssr';
import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { appConfig } from './app.config';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes([
      {
        path: 'en/mymatcher/**',
        renderMode: RenderMode.Server,
      },
      {
        path: '**',
        renderMode: RenderMode.Server,
      }
    ]))
  ]
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
