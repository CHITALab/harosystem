/**
 * テーマ適用サービス。
 *
 * SettingsService の themeMode (light / dark / system) と
 * darkTheme / lightTheme (各モードで使うテーマ名) を監視し、
 * <html> の data-theme / data-mode 属性へ反映する。
 * 実際の配色は styles.scss の html[data-theme='…'] ブロックが担う。
 *
 * system モードのときは prefers-color-scheme の変更にも追従する。
 * AppComponent で inject するだけで動き出す (constructor の effect が常駐)。
 */
import { Injectable, effect, inject, signal } from '@angular/core';
import { SettingsService } from './settings.service';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeDef {
  id: string;
  name: string;
}

/** ダークモードで選べるテーマ */
export const DARK_THEMES: readonly ThemeDef[] = [
  { id: 'neon', name: 'NEØN (シアン)' },
  { id: 'synthwave', name: 'SYNTHWAVE (ピンク/紫)' },
  { id: 'matrix', name: 'MATRIX (グリーン)' },
];

/** ライトモードで選べるテーマ */
export const LIGHT_THEMES: readonly ThemeDef[] = [
  { id: 'paper', name: 'PAPER (ブルー)' },
  { id: 'sakura', name: 'SAKURA (ローズ)' },
  { id: 'mint', name: 'MINT (グリーン)' },
];

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private settings = inject(SettingsService);

  /** OS のダークモード設定 (system モードのときに参照する) */
  private systemDark = signal(
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  constructor() {
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', (e) => this.systemDark.set(e.matches));

    // 設定 / OS テーマの変更に追従して <html> 属性を張り替える
    effect(() => {
      const s = this.settings.settings();
      const dark = s.themeMode === 'system' ? this.systemDark() : s.themeMode === 'dark';
      const theme = dark
        ? this.validate(s.darkTheme, DARK_THEMES, 'neon')
        : this.validate(s.lightTheme, LIGHT_THEMES, 'paper');
      const el = document.documentElement;
      el.dataset['theme'] = theme;
      el.dataset['mode'] = dark ? 'dark' : 'light'; // Material の色切替に使う
      el.style.colorScheme = dark ? 'dark' : 'light'; // ネイティブ部品 (scrollbar 等)
    });
  }

  /** 保存値が既知のテーマ id でなければ既定にフォールバックする */
  private validate(id: string, list: readonly ThemeDef[], fallback: string): string {
    return list.some((t) => t.id === id) ? id : fallback;
  }
}
