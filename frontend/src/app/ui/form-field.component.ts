/**
 * ラベル付きフォーム項目 <ui-form-field>。
 * 「小さい見出し + 入力部品」の縦並びレイアウトを共通化する。
 * 入力部品側は class="input" (styles.scss の共通スタイル) を付ける。
 *
 * 使用例:
 *   <ui-form-field label="タイトル">
 *     <input class="input" [(ngModel)]="title" />
 *   </ui-form-field>
 */
import { Component, Input } from '@angular/core';

@Component({
  selector: 'ui-form-field',
  standalone: true,
  host: { class: 'flex flex-col gap-1 flex-1 min-w-0' },
  template: `
    <label class="text-xs text-cyber-dim tracking-wider uppercase">{{ label }}</label>
    <ng-content />
  `,
})
export class UiFormFieldComponent {
  @Input() label = '';
}
