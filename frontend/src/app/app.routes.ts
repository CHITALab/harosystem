/**
 * ルーティング定義。
 *   /login    : ログイン画面 (認証不要)
 *   /         : カレンダー (メイン画面 / 要認証)
 *   /settings : 設定ページ (ユーザー設定 / 通知 / Webhook / ICS / 外部カレンダー / 要認証)
 *
 * 保護ルートには authGuard を付与する。未認証アクセスは /login へ飛ばされる。
 * ログイン画面は遅延ロード (Step 3 で実体を作成)。
 */
import { Routes } from '@angular/router';
import { CalendarPageComponent } from './features/calendar-page.component';
import { SettingsPageComponent } from './features/settings-page.component';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./features/login/login-page.component').then((m) => m.LoginPageComponent),
  },
  { path: '', component: CalendarPageComponent, canActivate: [authGuard] },
  { path: 'settings', component: SettingsPageComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: '' },
];
