/**
 * 共通モーダル <ui-modal>。
 * バックドロップ + ネオン枠のダイアログ。中身は ng-content で差し込む。
 * バックドロップクリックか ESC 相当の操作は (closed) で通知する。
 *
 * 使用例:
 *   <ui-modal title="// NEW EVENT" (closed)="store.closeForm()">
 *     ...フォーム...
 *   </ui-modal>
 */
import { Component, Input, output } from '@angular/core';

@Component({
  selector: 'ui-modal',
  standalone: true,
  template: `
    <!-- バックドロップ: クリックで閉じる -->
    <div
      class="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center"
      (click)="closed.emit()"
    >
      <!-- 本体: クリックを伝播させない -->
      <div
        class="w-[660px] max-w-[94vw] max-h-[92vh] overflow-y-auto bg-cyber-bg2
               border border-cyber-cyan shadow-glow-cyan-strong p-6 flex flex-col gap-4"
        (click)="$event.stopPropagation()"
      >
        <div class="flex items-center justify-between gap-3">
          <h2
            class="font-head text-[17px] tracking-[3px] text-cyber-cyan
                   drop-shadow-[0_0_10px_rgb(var(--c-cyan)/0.5)]"
          >
            {{ title }}
          </h2>
          <!-- 閉じるボタン: タップしやすい大きめサイズ -->
          <button
            type="button"
            class="text-3xl leading-none w-11 h-11 shrink-0 cursor-pointer text-cyber-dim
                   border border-transparent hover:text-cyber-red hover:border-cyber-red
                   hover:shadow-glow-red transition-all duration-150"
            aria-label="閉じる"
            (click)="closed.emit()"
          >×</button>
        </div>
        <ng-content />
      </div>
    </div>
  `,
})
export class UiModalComponent {
  @Input() title = '';
  closed = output<void>();
}
