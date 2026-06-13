/**
 * 種別バッジ <ui-badge>。
 * 「予定 = シアン / タスク = マゼンタ」の色分けルールを一箇所に集約する。
 * 枠色の規約を変えるときはこのファイルを修正する。
 *
 * 使用例: <ui-badge [kind]="selected.kind" />
 */
import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'ui-badge',
  standalone: true,
  host: { class: 'contents' },
  template: `<span [class]="classes()">{{ label() }}</span>`,
})
export class UiBadgeComponent {
  kind = input.required<'event' | 'task'>();

  label = computed(() => (this.kind() === 'event' ? 'EVENT' : 'TASK'));

  classes = computed(() => {
    const base = 'font-head text-xs tracking-[2px] px-2.5 py-1 border';
    return this.kind() === 'event'
      ? `${base} border-cyber-cyan text-cyber-cyan`
      : `${base} border-cyber-magenta text-cyber-magenta`;
  });
}
