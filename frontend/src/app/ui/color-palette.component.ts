/**
 * カラーパレット選択 UI。
 *
 * タイルの背景は「色 22〜26% + 暗色」の不透明ミックスで描画されるため、
 * 暗い背景の上でも文字が読みやすい明度の高いネオン系プリセットのみを提供する。
 * (自由入力の <input type="color"> だと暗い色が選べてしまい視認性が壊れる)
 *
 * 使い方:
 *   <ui-color-palette [value]="color" (valueChange)="color = $event" />
 */
import { Component, input, output } from '@angular/core';

/** 暗色タイル上で視認性が確保できるプリセット (ネオン系・高明度)。
 *  ライトテーマでは --chip-mix による暗色補正がかかるため両モードで読める。 */
export const PALETTE: readonly { color: string; name: string }[] = [
  { color: '#00f0ff', name: 'シアン' },
  { color: '#38bdf8', name: 'スカイ' },
  { color: '#4c7dff', name: 'ブルー' },
  { color: '#818cf8', name: 'インディゴ' },
  { color: '#2dd4bf', name: 'ティール' },
  { color: '#5eead4', name: 'アクア' },
  { color: '#39ff88', name: 'グリーン' },
  { color: '#86efac', name: 'ライトグリーン' },
  { color: '#a3e635', name: 'ライム' },
  { color: '#f5e642', name: 'イエロー' },
  { color: '#fbbf24', name: 'アンバー' },
  { color: '#ff9f1c', name: 'オレンジ' },
  { color: '#fb7185', name: 'ローズ' },
  { color: '#ff3b5c', name: 'レッド' },
  { color: '#fda4af', name: 'サーモン' },
  { color: '#ff7eb6', name: 'ピンク' },
  { color: '#f0abfc', name: 'オーキッド' },
  { color: '#ff2bd6', name: 'マゼンタ' },
  { color: '#b14cff', name: 'パープル' },
  { color: '#c4b5fd', name: 'ラベンダー' },
  { color: '#94a3b8', name: 'グレー' },
  { color: '#cdd6f4', name: 'ホワイト' },
];

@Component({
  selector: 'ui-color-palette',
  standalone: true,
  template: `
    <div class="flex flex-wrap gap-1.5">
      @for (p of palette; track p.color) {
        <button
          type="button"
          class="w-7 h-7 cursor-pointer border-2 transition-all"
          [class.scale-110]="value() === p.color"
          [style.background]="p.color"
          [style.border-color]="value() === p.color ? '#ffffff' : 'transparent'"
          [style.box-shadow]="value() === p.color ? '0 0 8px ' + p.color : 'none'"
          [title]="p.name + ' ' + p.color"
          [attr.aria-label]="p.name"
          [attr.aria-pressed]="value() === p.color"
          (click)="valueChange.emit(p.color)"
        ></button>
      }
    </div>
  `,
})
export class UiColorPaletteComponent {
  palette = PALETTE;
  /** 現在選択中の色 ('#rrggbb') */
  value = input.required<string>();
  /** スウォッチクリックで新しい色を通知 */
  valueChange = output<string>();
}
