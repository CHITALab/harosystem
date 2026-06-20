/**
 * カレンダーページ ("/") — 全体レイアウトと画面の出し分け。
 *
 *   ┌ header (ロゴ / ナビ / 期間タイトル / 表示切替 / 新規作成 / 設定リンク)
 *   ├ body
 *   │   ├ sidebar      (ラベル + タスク一覧)
 *   │   ├ main         (月: month-view / 日・週: time-grid)
 *   │   └ detail-panel (選択中アイテムがあるときだけ表示)
 *   └ item-form モーダル (store.form() があるときだけ表示)
 *
 * 状態はすべて StoreService (Signals) にあり、ここでは表示の組み立てのみ行う。
 * 設定は別ページ (/settings) に分離している。
 *
 * キーボード操作 (入力中・モーダル表示中は無効):
 *   ← / → : 前 / 次の期間へ移動
 *   ↑ / ↓ : 表示モード切替 (日 ⇔ 週 ⇔ 月)
 */
import { Component, OnDestroy, OnInit, effect, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SettingsService } from '../core/settings.service';
import { StoreService } from '../core/store.service';
import { SidebarComponent } from './sidebar.component';
import { MonthViewComponent } from './month-view.component';
import { TimeGridComponent } from './time-grid.component';
import { DetailPanelComponent } from './detail-panel.component';
import { ItemFormComponent } from './item-form.component';
import { UiButtonComponent } from '../ui/button.component';

@Component({
  selector: 'app-calendar-page',
  standalone: true,
  imports: [
    RouterLink,
    SidebarComponent,
    MonthViewComponent,
    TimeGridComponent,
    DetailPanelComponent,
    ItemFormComponent,
    UiButtonComponent,
  ],
  host: { '(document:keydown)': 'onKeydown($event)' },
  template: `
    <div class="flex flex-col h-screen">
      <!-- ヘッダー -->
      <header
        class="flex items-center gap-4 px-5 py-3 border-b border-cyber-lineStrong
               bg-cyber-panel shrink-0"
      >
        <div class="font-head text-xl tracking-[4px] text-cyber-cyan
                    drop-shadow-[0_0_12px_rgb(var(--c-cyan)/0.7)] select-none">
          HARO<span class="text-cyber-magenta">//</span>SYSTEM
        </div>

        <!-- 期間ナビゲーション -->
        <div class="flex gap-1.5">
          <ui-button (click)="store.navigate(-1)">&#9666;</ui-button>
          <ui-button (click)="store.navigate(0)">Today</ui-button>
          <ui-button (click)="store.navigate(1)">&#9656;</ui-button>
        </div>

        <div class="font-head text-base tracking-[2px] text-cyber-text min-w-[260px]">
          {{ store.title() }}
        </div>

        <!-- 表示モード切替 -->
        <div class="flex gap-1.5">
          <ui-button [active]="store.viewMode() === 'day'" (click)="store.setView('day')">日</ui-button>
          <ui-button [active]="store.viewMode() === 'week'" (click)="store.setView('week')">週</ui-button>
          <ui-button [active]="store.viewMode() === 'month'" (click)="store.setView('month')">月</ui-button>
        </div>

        <div class="flex-1"></div>

        <!-- 新規作成 (大きめサイズ) -->
        <ui-button variant="primary" size="lg" (click)="store.openForm({ kind: 'event' })">＋ 予定</ui-button>
        <ui-button variant="primary" size="lg" (click)="store.openForm({ kind: 'task' })">＋ タスク</ui-button>

        <!-- ノート / ボード -->
        <a
          routerLink="/notes"
          class="font-head text-sm tracking-wider text-cyber-dim hover:text-cyber-cyan p-1
                 hover:drop-shadow-[0_0_8px_rgb(var(--c-cyan)/0.8)] transition-all"
          title="ノート"
        >NOTES</a>
        <a
          routerLink="/board"
          class="font-head text-sm tracking-wider text-cyber-dim hover:text-cyber-cyan p-1
                 hover:drop-shadow-[0_0_8px_rgb(var(--c-cyan)/0.8)] transition-all"
          title="アクティブボード"
        >BOARD</a>
        <a
          routerLink="/backlog"
          class="font-head text-sm tracking-wider text-cyber-dim hover:text-cyber-cyan p-1
                 hover:drop-shadow-[0_0_8px_rgb(var(--c-cyan)/0.8)] transition-all"
          title="バックログ / スプリント計画"
        >BACKLOG</a>

        <!-- 設定 (歯車) -->
        @if (settings.settings().userName; as name) {
          <span class="text-sm text-cyber-dim max-w-[140px] truncate">{{ name }}</span>
        }
        <a
          routerLink="/settings"
          class="text-3xl leading-none text-cyber-dim hover:text-cyber-cyan p-1
                 hover:drop-shadow-[0_0_8px_rgb(var(--c-cyan)/0.8)] transition-all"
          title="設定"
        >⚙</a>
      </header>

      <!-- ボディ: サイドバー / メインビュー / 詳細パネル -->
      <div class="flex flex-1 min-h-0">
        <app-sidebar />
        <main class="flex-1 min-w-0 min-h-0 flex flex-col">
          @if (store.viewMode() === 'month') {
            <app-month-view />
          } @else {
            <app-time-grid />
          }
        </main>
        @if (store.selected(); as sel) {
          <app-detail-panel [selected]="sel" />
        }
      </div>

      <!-- 作成/編集モーダル -->
      @if (store.form()) {
        <app-item-form />
      }
    </div>
  `,
})
export class CalendarPageComponent implements OnInit, OnDestroy {
  store = inject(StoreService);
  settings = inject(SettingsService);

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // 設定の自動更新間隔に追従してポーリングを張り替える
    // (外部カレンダーの変更を「リアルタイム」に反映するための定期再取得)
    effect(() => {
      const sec = this.settings.settings().autoRefreshSec;
      if (this.refreshTimer) clearInterval(this.refreshTimer);
      this.refreshTimer = sec > 0 ? setInterval(() => this.store.reload(), sec * 1000) : null;
    });
  }

  ngOnInit(): void {
    this.store.loadLabels();
    this.store.loadFeeds();
    this.store.loadNotes(); // タスクフォームのノート選択で使う
    this.store.reload();
  }

  /** 矢印キーによるカレンダー操作。入力中・モーダル表示中は何もしない */
  onKeydown(e: KeyboardEvent): void {
    if (this.store.form()) return; // 作成/編集モーダル表示中
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
    ) {
      return; // フォーム入力中はカーソル移動を妨げない
    }

    const modes = ['day', 'week', 'month'] as const;
    switch (e.key) {
      case 'ArrowLeft':
        this.store.navigate(-1);
        break;
      case 'ArrowRight':
        this.store.navigate(1);
        break;
      case 'ArrowUp': {
        // 広い表示へ (日 → 週 → 月)
        const i = modes.indexOf(this.store.viewMode());
        if (i < modes.length - 1) this.store.setView(modes[i + 1]);
        break;
      }
      case 'ArrowDown': {
        // 狭い表示へ (月 → 週 → 日)
        const i = modes.indexOf(this.store.viewMode());
        if (i > 0) this.store.setView(modes[i - 1]);
        break;
      }
      default:
        return; // 対象外のキーは preventDefault しない
    }
    e.preventDefault();
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }
}
