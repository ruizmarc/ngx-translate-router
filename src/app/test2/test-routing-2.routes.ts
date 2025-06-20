import { Routes } from '@angular/router';

import { BobComponent } from './bob/bob.component';
import { Test2Component } from './test2/test2.component';

export const testRouting2Routes: Routes = [
  {
    path: '',
    component: Test2Component,
    children: [
      // { path: 'sarah', component: BobComponent },
      // { path: 'both', component: BobComponent },
      { path: 'sarah', component: BobComponent, data: { skipRouteLocalization: true } },
      { path: 'both', component: BobComponent, data: { skipRouteLocalization: true } }
    ]
  }
];
