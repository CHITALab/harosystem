/**
 * ユーザー設定 — localStorage に永続化する Signals。
 *
 * サーバーには保存しない (ブラウザごとの個人設定)。
 * 項目を追加するときは AppSettings と DEFAULTS に足すだけでよい。
 * 設定画面は features/settings-page.component.ts (/settings ページ)。
 */
import { Injectable, signal } from '@angular/core';
import { ViewMode } from './models';

export interface AppSettings {
  /** 表示名 (ヘッダーに出る) */
  userName: string;
  /** 起動時のカレンダー表示モード */
  defaultView: ViewMode;
  /** データの自動再取得間隔 (秒)。0 = 無効 */
  autoRefreshSec: number;
  /** 新規作成時に通知を ON にしておくか */
  notifyDefault: boolean;
  /** 新規作成時の通知タイミング既定値 (開始/期限の何分前か) */
  notifyBeforeMin: number;
  /** 外観モード: ライト / ダーク / システム (OS 設定) 依存 */
  themeMode: 'light' | 'dark' | 'system';
  /** ダークモードで使うテーマ id (theme.service.ts の DARK_THEMES) */
  darkTheme: string;
  /** ライトモードで使うテーマ id (theme.service.ts の LIGHT_THEMES) */
  lightTheme: string;
}

const STORAGE_KEY = 'neon-cal-settings';

const DEFAULTS: AppSettings = {
  userName: '',
  defaultView: 'week',
  autoRefreshSec: 60,
  notifyDefault: false,
  notifyBeforeMin: 10,
  themeMode: 'system',
  darkTheme: 'neon',
  lightTheme: 'paper',
};

@Injectable({ providedIn: 'root' })
export class SettingsService {
  /** 現在の設定値。更新は update() 経由で行うこと (永続化されるため) */
  readonly settings = signal<AppSettings>(this.load());

  private load(): AppSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      // 既定値とマージすることで、項目追加後も古い保存データを安全に読める
      return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
    } catch {
      return { ...DEFAULTS };
    }
  }

  /** 一部の項目だけ更新して保存する */
  update(patch: Partial<AppSettings>): void {
    const next = { ...this.settings(), ...patch };
    this.settings.set(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
}
