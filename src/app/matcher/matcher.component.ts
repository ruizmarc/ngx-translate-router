import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, RouterLinkActive, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { LocalizeRouterPipe } from 'ngx-translate-router';


@Component({
  selector: 'app-matcher',
  templateUrl: './matcher.component.html',
  styleUrls: ['./matcher.component.css'],
  imports: [RouterLinkActive, RouterLink, LocalizeRouterPipe]
})
export class MatcherComponent implements OnInit, OnDestroy {

  params: string[] = [];
  private paramsSubscription: Subscription;

  constructor(private route: ActivatedRoute) { }

  ngOnInit() {
    console.log('init');
    this.paramsSubscription = this.route.paramMap.subscribe((paramMap) => {
      console.log('params:', paramMap);
      this.params = [];
      const keys = [...paramMap.keys];
      for (const key of keys) {
        this.params.push(`${key}: ${paramMap.get(key)}`);
      }
    });
  }

  ngOnDestroy() {
    if (this.paramsSubscription) {
      this.paramsSubscription.unsubscribe();
    }
  }

}
