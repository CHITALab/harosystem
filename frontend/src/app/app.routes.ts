/**
 * ルーティング定義。
 *   /         : カレンダー (メイン画面)
 *   /settings : 設定ページ (ユーザー設定 / 通知 / Webhook / ICS / 外部カレンダー)
 */
import { Routes } from '@angular/router';
import { CalendarPageComponent } from './features/calendar-page.component';
import { SettingsPageComponent } from './features/settings-page.component';

export const routes: Routes = [
  { path: '', component: CalendarPageComponent },
  { path: 'settings', component: SettingsPageComponent },
  { path: '**', redirectTo: '' },
];
