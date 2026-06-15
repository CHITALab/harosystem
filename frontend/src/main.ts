import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { authInterceptor } from './app/core/auth.interceptor';
import { provideAuthInitializer } from './app/core/auth.init';

bootstrapApplication(AppComponent, {
  providers: [
    // 全 HTTP リクエストに Authorization 付与 + 401 ハンドリングを行う
    provideHttpClient(withInterceptors([authInterceptor])),
    provideRouter(routes),
    provideAnimationsAsync(), // Angular Material のアニメーションに必要
    // 起動前に保存済みトークンを検証 (画面のちらつき防止)
    provideAuthInitializer(),
  ],
}).catch((err) => console.error(err));
