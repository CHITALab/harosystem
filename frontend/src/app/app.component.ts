/**
 * ルートコンポーネント — ページの出し分けは Router に委ねるシェル。
 * 画面の実体は features/calendar-page (/) と features/settings-page (/settings)。
 *
 * アプリ全体で 1 回だけ行う初期化をここに置く:
 *   - 起動時ビューの適用 (設定の既定ビュー)
 *   - アプリ内通知サービスの起動
 */
import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NotificationService } from './core/notification.service';
import { SettingsService } from './core/settings.service';
import { StoreService } from './core/store.service';
import { ThemeService } from './core/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class AppComponent {
  constructor() {
    const store = inject(StoreService);
    const settings = inject(SettingsService);
    // 起動時は設定の既定ビューで開く (ページ遷移ではリセットしない)
    store.viewMode.set(settings.settings().defaultView);
    // 通知 ON のアイテムを定期チェックしてブラウザ通知/トーストを出す
    inject(NotificationService).start();
    // 外観テーマ (light/dark/system) を <html> 属性へ反映する常駐 effect
    inject(ThemeService);
  }
}
