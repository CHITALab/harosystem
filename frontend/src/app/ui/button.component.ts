/**
 * 共通ボタン <ui-button>。
 * アプリ内のボタンの見た目はすべてここで一元管理する。
 * 見た目を変えたいときはこのファイルの VARIANTS だけを修正すればよい。
 *
 * 使用例:
 *   <ui-button (click)="save()">Save</ui-button>
 *   <ui-button variant="primary">+ 予定</ui-button>
 *   <ui-button variant="danger" (click)="remove()">Delete</ui-button>
 *   <ui-button [active]="mode === 'day'">日</ui-button>
 */
import { Component, Input, computed, input } from '@angular/core';

type Variant = 'ghost' | 'primary' | 'danger';
type Size = 'md' | 'lg';

const BASE =
  'font-mono uppercase tracking-wider cursor-pointer ' +
  'border transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed';

/** サイズ別のパディング/文字サイズ (lg は主要アクション用に大きめ) */
const SIZES: Record<Size, string> = {
  md: 'text-sm px-4 py-2',
  lg: 'text-base px-6 py-3',
};

const VARIANTS: Record<Variant, string> = {
  // 通常ボタン: ホバーでシアン発光
  ghost:
    'bg-transparent text-cyber-text border-cyber-lineStrong ' +
    'hover:border-cyber-cyan hover:text-cyber-cyan hover:shadow-glow-cyan',
  // 強調ボタン: 常にシアン
  primary:
    'bg-transparent text-cyber-cyan border-cyber-cyan ' +
    'hover:shadow-glow-cyan',
  // 危険操作: ホバーで赤発光
  danger:
    'bg-transparent text-cyber-text border-cyber-lineStrong ' +
    'hover:border-cyber-red hover:text-cyber-red hover:shadow-glow-red',
};

/** トグル選択中の追加スタイル */
const ACTIVE = 'bg-cyber-cyan/10 !border-cyber-cyan !text-cyber-cyan';

@Component({
  selector: 'ui-button',
  standalone: true,
  host: { class: 'contents' },
  template: `
    <button [type]="type" [disabled]="disabled" [class]="classes()">
      <ng-content />
    </button>
  `,
})
export class UiButtonComponent {
  variant = input<Variant>('ghost');
  /** ボタンの大きさ。主要アクション (＋ 予定など) は 'lg' を使う */
  size = input<Size>('md');
  /** トグルボタンとして選択中かどうか */
  active = input(false);
  @Input() type: 'button' | 'submit' = 'button';
  @Input() disabled = false;

  classes = computed(
    () =>
      `${BASE} ${SIZES[this.size()]} ${VARIANTS[this.variant()]} ${this.active() ? ACTIVE : ''}`,
  );
}
