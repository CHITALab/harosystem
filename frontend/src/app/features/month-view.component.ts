/**
 * 月ビュー — 6週 × 7日 のグリッド。
 *   - チップはラベル色ティント背景、予定=シアン実線 / タスク=マゼンタ破線の枠
 *   - チップを別の日へ HTML5 D&D で移動 (時刻は維持)
 *   - セルのダブルクリックでその日 9:00 の予定を新規作成
 *   - ホイールで前月/翌月へ移動
 */
import { Component, computed, inject } from '@angular/core';
import { ApiService } from '../core/api.service';
import { ToastService } from '../core/toast.service';
import { catchError, EMPTY } from 'rxjs';
import { StoreService } from '../core/store.service';
import { EventItem, FeedEvent, TaskItem } from '../core/models';
import { addDays, fmtTime, sameDay, startOfDay, WEEKDAYS_JA } from '../core/util';

interface MonthCell {
  date: Date;
  inMonth: boolean; // 表示中の月に属する日か (前後月はグレーアウト)
  today: boolean;
  events: EventItem[];
  tasks: TaskItem[];
  feedEvents: FeedEvent[]; // 外部カレンダー (読み取り専用)
}

/** チップ共通の Tailwind クラス (予定/タスクで枠線が異なる) */
const CHIP =
  'text-sm leading-snug px-2 py-1 cursor-grab shrink-0 truncate text-cyber-text ' +
  '[text-shadow:0_1px_2px_rgb(var(--c-bg)/0.8)] border-l-4 hover:brightness-150 select-none';
const CHIP_EVENT = `${CHIP} border border-cyber-cyan/50`;
const CHIP_TASK = `${CHIP} border border-dashed border-cyber-magenta/60 flex items-center gap-1`;
/** 外部カレンダーのチップ: 点線枠・操作不可 (読み取り専用) */
const CHIP_FEED =
  'text-sm leading-snug px-2 py-1 shrink-0 truncate text-cyber-text opacity-80 ' +
  '[text-shadow:0_1px_2px_rgb(var(--c-bg)/0.8)] border border-dotted cursor-default';

@Component({
  selector: 'app-month-view',
  standalone: true,
  host: { class: 'block h-full min-h-0' },
  template: `
    <div class="flex flex-col h-full" (wheel)="onWheel($event)" title="ホイールで月移動">
      <!-- 曜日ヘッダー -->
      <div class="grid grid-cols-7 border-b border-cyber-lineStrong">
        @for (w of weekdays; track w; let i = $index) {
          <div
            class="text-center py-2 font-head text-[13px] tracking-[2px]"
            [class.text-cyber-red]="i === 0"
            [class.text-cyber-cyan]="i === 6"
            [class.text-cyber-dim]="i !== 0 && i !== 6"
          >{{ w }}</div>
        }
      </div>

      <!-- 日セル (6週 = 42 マス) -->
      <div class="flex-1 grid grid-cols-7 grid-rows-6 min-h-0">
        @for (cell of cells(); track cell.date.getTime()) {
          <div
            class="border-r border-b border-cyber-line p-1.5 overflow-hidden cursor-pointer
                   flex flex-col gap-1 min-h-0 hover:bg-cyber-cyan/[0.04]"
            [class.opacity-35]="!cell.inMonth"
            (dblclick)="newEventAt(cell.date)"
            (dragover)="$event.preventDefault()"
            (drop)="onDrop($event, cell.date)"
          >
            <span
              class="text-sm w-fit"
              [class.text-cyber-dim]="!cell.today"
              [class.bg-cyber-cyan]="cell.today"
              [class.text-cyber-bg]="cell.today"
              [class.px-1.5]="cell.today"
              [class.shadow-glow-cyan]="cell.today"
            >{{ cell.date.getDate() }}</span>

            <!-- 予定チップ -->
            @for (ev of cell.events.slice(0, 3); track ev.id) {
              <div
                [class]="chipEvent"
                draggable="true"
                [style.border-left-color]="evColor(ev)"
                [style.background]="tint(evColor(ev))"
                (dragstart)="onDragStart($event, 'event', ev.id)"
                (click)="store.select({ kind: 'event', item: ev }); $event.stopPropagation()"
                (dblclick)="openEdit('event', ev, $event)"
              >
                @if (!ev.all_day) {
                  <span class="text-[11.5px] text-cyber-cyan mr-0.5">{{ time(ev.start_at) }}</span>
                }
                {{ ev.title }}
              </div>
            }

            <!-- タスクチップ (チェックボックスで完了切替) -->
            @for (task of cell.tasks.slice(0, 2); track task.id) {
              <div
                [class]="chipTask"
                draggable="true"
                [class.opacity-55]="task.done"
                [class.line-through]="task.done"
                [class.!border-cyber-green]="task.done"
                [style.border-left-color]="task.done ? null : taskColor(task)"
                [style.background]="task.done ? 'color-mix(in srgb, rgb(var(--c-green)) 12%, var(--c-tile-base))' : tint(taskColor(task))"
                (dragstart)="onDragStart($event, 'task', task.id)"
                (click)="store.select({ kind: 'task', item: task }); $event.stopPropagation()"
                (dblclick)="openEdit('task', task, $event)"
              >
                <input
                  type="checkbox"
                  class="!w-[15px] !h-[15px] shrink-0"
                  [checked]="task.done"
                  (click)="toggleDone(task, $event)"
                  (mousedown)="$event.stopPropagation()"
                />
                <span class="truncate">{{ task.title }}</span>
              </div>
            }

            <!-- 外部カレンダーのチップ (読み取り専用) -->
            @for (fe of cell.feedEvents.slice(0, 2); track fe.id) {
              <div
                [class]="chipFeed"
                [style.border-color]="fe.feed.color"
                [style.background]="tint(fe.feed.color)"
                [title]="fe.feed.name + ': ' + fe.title"
                (dblclick)="$event.stopPropagation()"
              >
                <span class="text-[11px] opacity-80" [style.color]="fe.feed.color">◇</span>
                {{ fe.title }}
              </div>
            }

            @if (moreCount(cell) > 0) {
              <span class="text-xs text-cyber-dim">+{{ moreCount(cell) }} more</span>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class MonthViewComponent {
  store = inject(StoreService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  weekdays = WEEKDAYS_JA;
  chipEvent = CHIP_EVENT;
  chipTask = CHIP_TASK;
  chipFeed = CHIP_FEED;

  private lastWheel = 0;

  /** 表示範囲 42 日ぶんのセルを、日ごとの予定/タスク付きで導出する */
  cells = computed<MonthCell[]>(() => {
    const [start] = this.store.range();
    const month = this.store.anchor().getMonth();
    const today = startOfDay(new Date());
    const events = this.store.events();
    const tasks = this.store.tasks();
    const feedEvents = this.store.visibleFeedEvents();
    const result: MonthCell[] = [];
    for (let i = 0; i < 42; i++) {
      const date = addDays(start, i);
      const next = addDays(date, 1);
      result.push({
        date,
        inMonth: date.getMonth() === month,
        today: sameDay(date, today),
        events: events.filter(
          (e) => new Date(e.start_at) < next && new Date(e.end_at) > date,
        ),
        tasks: tasks.filter((t) => t.due_at && sameDay(new Date(t.due_at), date)),
        feedEvents: feedEvents.filter(
          (f) => new Date(f.start_at) < next && new Date(f.end_at) > date,
        ),
      });
    }
    return result;
  });

  /** セルに表示しきれなかった件数 (予定 3 / タスク 2 / 外部 2 件まで表示) */
  moreCount(cell: MonthCell): number {
    const total = cell.events.length + cell.tasks.length + cell.feedEvents.length;
    const shown =
      Math.min(cell.events.length, 3) +
      Math.min(cell.tasks.length, 2) +
      Math.min(cell.feedEvents.length, 2);
    return total - shown;
  }

  /** チップの表示色: 個別色 > ラベル色 > 既定色 (テーマで明度補正) */
  evColor(ev: EventItem): string {
    return this.ink(ev.color ?? ev.label?.color ?? 'rgb(var(--c-cyan))');
  }

  taskColor(task: TaskItem): string {
    return this.ink(task.color ?? task.label?.color ?? 'rgb(var(--c-magenta))');
  }

  /** ライトテーマではネオン色を暗めに補正して可読性を確保する */
  private ink(color: string): string {
    return `color-mix(in srgb, ${color} var(--chip-mix), var(--chip-ink))`;
  }

  /** 表示色を背景用に薄める。不透過 (背面の罫線が透けないよう基底色と混色) */
  tint(color: string): string {
    return `color-mix(in srgb, ${color} 26%, var(--c-tile-base))`;
  }

  /** チップのダブルクリックで編集フォームを開く (セルの「新規作成」は発火させない) */
  openEdit(kind: 'event' | 'task', item: EventItem | TaskItem, e: MouseEvent): void {
    e.stopPropagation();
    this.store.openForm({ kind, item });
  }

  time(iso: string): string {
    return fmtTime(new Date(iso));
  }

  onWheel(e: WheelEvent): void {
    e.preventDefault();
    const now = Date.now();
    if (now - this.lastWheel < 200) return; // トラックパッドの連続発火を抑制
    this.lastWheel = now;
    this.store.navigate(e.deltaY > 0 ? 1 : -1);
  }

  // ---- D&D: 日をまたぐ移動 (時刻は維持) ----
  onDragStart(e: DragEvent, kind: 'event' | 'task', id: number): void {
    e.dataTransfer?.setData('text/plain', `${kind}:${id}`);
  }

  onDrop(e: DragEvent, date: Date): void {
    e.preventDefault();
    const data = e.dataTransfer?.getData('text/plain');
    if (!data) return;
    const [kind, idStr] = data.split(':');
    const id = Number(idStr);

    if (kind === 'event') {
      const ev = this.store.events().find((x) => x.id === id);
      if (!ev) return;
      const deltaMs = date.getTime() - startOfDay(new Date(ev.start_at)).getTime();
      if (deltaMs === 0) return;
      this.api
        .updateEvent(id, {
          start_at: new Date(new Date(ev.start_at).getTime() + deltaMs).toISOString(),
          end_at: new Date(new Date(ev.end_at).getTime() + deltaMs).toISOString(),
        })
        .pipe(catchError(() => { this.toast.error('移動に失敗しました'); return EMPTY; }))
        .subscribe((item) => this.store.syncSelected('event', item));
    } else {
      const task = this.store.tasks().find((x) => x.id === id);
      if (!task?.due_at) return;
      const deltaMs = date.getTime() - startOfDay(new Date(task.due_at)).getTime();
      if (deltaMs === 0) return;
      this.api
        .updateTask(id, {
          due_at: new Date(new Date(task.due_at).getTime() + deltaMs).toISOString(),
        })
        .pipe(catchError(() => { this.toast.error('移動に失敗しました'); return EMPTY; }))
        .subscribe((item) => this.store.syncSelected('task', item));
    }
  }

  toggleDone(task: TaskItem, ev: MouseEvent): void {
    ev.stopPropagation();
    this.api
      .updateTask(task.id, { done: !task.done })
      .pipe(catchError(() => { this.toast.error('完了状態の更新に失敗しました'); return EMPTY; }))
      .subscribe((item) => this.store.syncSelected('task', item));
  }

  newEventAt(date: Date): void {
    const start = new Date(date);
    start.setHours(9, 0, 0, 0);
    this.store.openForm({ kind: 'event', prefillStart: start });
  }
}
