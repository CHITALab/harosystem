/**
 * タイムグリッド (日/週ビュー) — 24時間 × 1日 or 7日。
 *
 * 機能:
 *   - 予定: 開始〜終了の高さで表示。重なりは横並びに自動レイアウト
 *           (枠 = シアン実線、左端のみラベル色)
 *   - タスク: 期限時刻の位置に作業時間ぶんの高さで表示
 *           (枠 = マゼンタ破線、チェックボックスで完了切替)
 *   - D&D 移動: チップ本体をドラッグ → 時刻 (15分スナップ) / 曜日を変更
 *   - リサイズ: チップ下端のハンドルをドラッグ →
 *           予定は終了時刻、タスクは作業時間を伸縮
 *   - ホイール: 曜日ヘッダー上 or Alt+ホイールで前後の日/週へ
 *   - ダブルクリック: その時刻に予定を新規作成
 *
 * 時間 <-> ピクセルの換算は PX_PER_MIN (1.2px/分 = 72px/時) で統一している。
 */
import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ApiService } from '../core/api.service';
import { ToastService } from '../core/toast.service';
import { catchError, EMPTY } from 'rxjs';
import { StoreService } from '../core/store.service';
import { EventItem, FeedEvent, Selected, TaskItem } from '../core/models';
import { addDays, fmtTime, sameDay, startOfDay, WEEKDAYS_JA } from '../core/util';

const PX_PER_MIN = 1.2; // 72px / 時
const SNAP_MIN = 15; // D&D・リサイズのスナップ単位 (分)
const DAY_HEIGHT = 24 * 60 * PX_PER_MIN; // 1728px

/** 1日ぶんに切り出した予定の描画情報 */
interface EventSeg {
  ev: EventItem;
  top: number;
  height: number;
  left: string; // 重なり時の横位置 (%)
  width: string;
  zIndex: number; // カスケード表示の重なり順 (右のチップほど手前)
}

interface TaskSeg {
  task: TaskItem;
  top: number;
  height: number; // 作業時間ぶん (未設定なら最小高)
  left: string; // 重なり時の横位置 (%)
  width: string;
  zIndex: number; // 予定より手前 (20+) に積む
}

/** 外部カレンダー (購読フィード) の予定。読み取り専用で重ねて表示する */
interface FeedSeg {
  fe: FeedEvent;
  top: number;
  height: number;
}

interface DayCol {
  date: Date;
  today: boolean;
  events: EventSeg[];
  tasks: TaskSeg[];
  feedEvents: FeedSeg[];
  allDay: EventItem[]; // 終日予定はヘッダー側に表示
  allDayFeed: FeedEvent[]; // 外部フィードの終日予定 (読み取り専用・ヘッダー表示)
}

/** ドラッグ/リサイズ中の作業状態 (pointer capture で追跡) */
interface DragState {
  mode: 'move' | 'resize';
  kind: 'event' | 'task';
  id: number;
  el: HTMLElement;
  startX: number;
  startY: number;
  origStart: Date; // 予定=開始 / タスク=期限
  origEnd: Date | null;
  origHeight: number;
  durMin: number; // 予定=所要時間 / タスク=作業時間
  colWidth: number;
  dayIndex: number;
  nDays: number;
  moved: boolean; // 5px 以上動いたら true (クリックと区別)
  dxDays: number; // 確定済みの移動量 (日)
  dyMin: number; // 確定済みの移動量 (分)
}

/** チップ共通クラス。予定/タスクで枠の色・線種を変えている。
 *  背景は不透過 (背面の罫線が透けると読みにくいため、cyber-bg2 ベースの混色)。 */
const EVENT_CHIP =
  'absolute overflow-hidden cursor-grab text-[13px] leading-[1.3] px-2 py-1 ' +
  'border border-cyber-cyan border-l-[3px] bg-cyber-bg3 ' +
  'shadow-[0_0_8px_rgb(var(--c-cyan)/0.15)] hover:brightness-140 ' +
  'touch-none select-none';
const TASK_CHIP =
  'absolute min-h-[26px] overflow-hidden cursor-grab text-[13px] px-2 py-0.5 ' +
  'border border-dashed border-cyber-magenta border-l-[3px] border-l-solid bg-cyber-bg3 ' +
  'flex items-start gap-1 hover:brightness-140 touch-none select-none';
/** 外部カレンダーのチップ: 点線枠・操作不可 (読み取り専用) */
const FEED_CHIP =
  'absolute left-0.5 right-0.5 overflow-hidden cursor-default text-[12.5px] leading-[1.3] ' +
  'px-1.5 py-0.5 border border-dotted opacity-90 z-[5] select-none';

@Component({
  selector: 'app-time-grid',
  standalone: true,
  host: { class: 'block h-full min-h-0' },
  template: `
    <div class="flex flex-col h-full">
      <!-- 曜日ヘッダー (ホイールで日付移動 / クリックで日ビューへ) -->
      <div
        class="grid border-b border-cyber-lineStrong pr-2"
        [style.grid-template-columns]="gridCols()"
        (wheel)="onWheel($event)"
        title="ホイールで日付移動"
      >
        <div class="border-r border-cyber-line"></div>
        @for (col of cols(); track col.date.getTime()) {
          <div
            class="text-center py-2 px-1 border-r border-cyber-line font-head text-sm
                   tracking-wide cursor-pointer hover:text-cyber-cyan"
            (click)="gotoDay(col.date)"
          >
            {{ weekdays[col.date.getDay()] }}
            <span
              class="block text-[22px]"
              [class.text-cyber-cyan]="col.today"
              [class.drop-shadow-[0_0_10px_rgb(var(--c-cyan))]]="col.today"
            >{{ col.date.getDate() }}</span>
            <!-- 終日予定 -->
            <div class="flex flex-col gap-0.5 p-0.5 min-h-1">
              @for (ev of col.allDay; track ev.id) {
                <div
                  class="text-[13px] px-1.5 py-0.5 truncate cursor-pointer border-l-4
                         border border-cyber-cyan/50 hover:brightness-150"
                  [style.border-left-color]="evColor(ev)"
                  [style.background]="tint(evColor(ev))"
                  (click)="store.select({ kind: 'event', item: ev }); $event.stopPropagation()"
                  (dblclick)="chipDblClick('event', ev, $event)"
                >{{ ev.title }}</div>
              }
              <!-- 外部フィードの終日予定 (読み取り専用) -->
              @for (fe of col.allDayFeed; track fe.id) {
                <div
                  class="text-[13px] px-1.5 py-0.5 truncate border border-dotted opacity-90
                         cursor-default font-mono normal-case tracking-normal"
                  [style.border-color]="fe.feed.color"
                  [style.background]="'color-mix(in srgb, ' + fe.feed.color + ' 14%, var(--c-tile-base))'"
                  [title]="fe.feed.name + ': ' + fe.title"
                  (click)="$event.stopPropagation()"
                >
                  <span [style.color]="fe.feed.color">◇</span> {{ fe.title }}
                </div>
              }
            </div>
          </div>
        }
      </div>

      <!-- 24時間グリッド本体 -->
      <div class="flex-1 overflow-y-auto" #scroll (wheel)="onBodyWheel($event)">
        <div
          class="grid"
          [style.grid-template-columns]="gridCols()"
          [style.height.px]="dayHeight"
        >
          <!-- 時刻ラベル列 -->
          <div class="border-r border-cyber-line">
            @for (h of hours; track h) {
              <div class="h-[72px] text-xs text-cyber-dim text-right pr-1.5 -translate-y-1.5">
                {{ h }}:00
              </div>
            }
          </div>

          <!-- 日ごとの列 -->
          @for (col of cols(); track col.date.getTime(); let di = $index) {
            <div
              class="day-col relative border-r border-cyber-line"
              [style.background-color]="col.today ? 'rgb(var(--c-cyan) / 0.03)' : null"
              (dblclick)="newEventAt(col.date, $event)"
            >
              <!-- 外部カレンダーの予定 (読み取り専用・通常の予定の背面に表示) -->
              @for (seg of col.feedEvents; track seg.fe.id) {
                <div
                  [class]="feedChip"
                  [style.top.px]="seg.top"
                  [style.height.px]="seg.height"
                  [style.border-color]="seg.fe.feed.color"
                  [style.color]="seg.fe.feed.color"
                  [style.background]="'color-mix(in srgb, ' + seg.fe.feed.color + ' 12%, var(--c-tile-base))'"
                  [title]="seg.fe.feed.name + ': ' + seg.fe.title"
                >
                  <span class="text-[10.5px] opacity-80">◇ {{ seg.fe.feed.name }}</span><br />
                  <span class="text-cyber-text">{{ seg.fe.title }}</span>
                </div>
              }

              <!-- 予定チップ -->
              @for (seg of col.events; track seg.ev.id) {
                <div
                  [class]="eventChip"
                  [style.top.px]="seg.top"
                  [style.height.px]="seg.height"
                  [style.left]="seg.left"
                  [style.width]="seg.width"
                  [style.z-index]="seg.zIndex"
                  [style.outline]="isSelected('event', seg.ev.id) ? '2px solid rgb(var(--c-cyan))' : null"
                  [style.outline-offset]="'-1px'"
                  [style.border-left-color]="evColor(seg.ev)"
                  [style.background]="tint(evColor(seg.ev))"
                  (pointerdown)="dragStart($event, 'event', seg.ev, di)"
                  (pointermove)="dragMove($event)"
                  (pointerup)="dragEnd($event)"
                  (pointercancel)="dragEnd($event)"
                  (click)="chipClick('event', seg.ev)"
                  (dblclick)="chipDblClick('event', seg.ev, $event)"
                >
                  <span class="text-[11px] text-cyber-dim">{{ timeRange(seg.ev) }}</span><br />
                  @if (seg.ev.recurrence) { <span title="繰り返し">↻</span> }{{ seg.ev.title }}
                  @if (!seg.ev.recurrence) {
                    <div class="resize-handle" (pointerdown)="resizeStart($event, 'event', seg.ev, di)"></div>
                  }
                </div>
              }

              <!-- タスクチップ -->
              @for (seg of col.tasks; track seg.task.id) {
                <div
                  [class]="taskChip"
                  [class.opacity-55]="seg.task.done"
                  [class.line-through]="seg.task.done"
                  [class.!border-cyber-green]="seg.task.done"
                  [style.background]="seg.task.done ? 'color-mix(in srgb, rgb(var(--c-green)) 12%, var(--c-tile-base))' : tint(taskColor(seg.task))"
                  [style.top.px]="seg.top"
                  [style.height.px]="seg.height"
                  [style.left]="seg.left"
                  [style.width]="seg.width"
                  [style.z-index]="seg.zIndex"
                  [style.outline]="isSelected('task', seg.task.id) ? '2px solid rgb(var(--c-cyan))' : null"
                  [style.outline-offset]="'-1px'"
                  [style.border-left-color]="seg.task.done ? null : taskColor(seg.task)"
                  (pointerdown)="dragStart($event, 'task', seg.task, di)"
                  (pointermove)="dragMove($event)"
                  (pointerup)="dragEnd($event)"
                  (pointercancel)="dragEnd($event)"
                  (click)="chipClick('task', seg.task)"
                  (dblclick)="chipDblClick('task', seg.task, $event)"
                >
                  <input
                    type="checkbox"
                    class="!w-3.5 !h-3.5 shrink-0 mt-1"
                    [checked]="seg.task.done"
                    (pointerdown)="$event.stopPropagation()"
                    (click)="toggleDone(seg.task, $event)"
                  />
                  <span class="truncate">{{ seg.task.title }}</span>
                  <div class="resize-handle" (pointerdown)="resizeStart($event, 'task', seg.task, di)"></div>
                </div>
              }

              <!-- 現在時刻ライン (今日の列のみ) -->
              @if (col.today) {
                <div class="now-line" [style.top.px]="nowMinutes()"></div>
              }
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class TimeGridComponent implements AfterViewInit, OnDestroy {
  store = inject(StoreService);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  weekdays = WEEKDAYS_JA;
  hours = Array.from({ length: 24 }, (_, i) => i);
  dayHeight = DAY_HEIGHT;
  eventChip = EVENT_CHIP;
  taskChip = TASK_CHIP;
  feedChip = FEED_CHIP;

  @ViewChild('scroll') scrollRef?: ElementRef<HTMLElement>;

  /** 現在時刻ラインの位置 (px)。1分ごとに更新 */
  nowMinutes = signal(this.calcNow());
  private timer = setInterval(() => this.nowMinutes.set(this.calcNow()), 60_000);

  private drag: DragState | null = null;
  private suppressClick = false; // ドラッグ直後の click で詳細を開かないためのフラグ
  private lastWheel = 0;

  gridCols = computed(() => `60px repeat(${this.nDays()}, 1fr)`);

  private nDays(): number {
    return this.store.viewMode() === 'day' ? 1 : 7;
  }

  /** 表示中の各日について、描画用の予定/タスク配置を導出する */
  cols = computed<DayCol[]>(() => {
    const [start] = this.store.range();
    const n = this.nDays();
    const today = startOfDay(new Date());
    const events = this.store.events();
    const tasks = this.store.tasks();
    const feedEvents = this.store.visibleFeedEvents();
    const result: DayCol[] = [];
    for (let i = 0; i < n; i++) {
      const date = addDays(start, i);
      const next = addDays(date, 1);
      const dayEvents = events.filter(
        (e) => !e.all_day && new Date(e.start_at) < next && new Date(e.end_at) > date,
      );
      // スケジュール済み (start/end あり) かつこの日に重なるタスク
      const dayTasks = tasks.filter(
        (t) => t.start_at && t.end_at && new Date(t.start_at) < next && new Date(t.end_at) > date,
      );
      // 予定とタスクを 1 つのカスケードに統合配置する (重なりを一緒にずらして回避)
      const laid = this.layoutDay(dayEvents, dayTasks, date, next);
      result.push({
        date,
        today: sameDay(date, today),
        events: laid.events,
        tasks: laid.tasks,
        feedEvents: feedEvents
          .filter(
            (f) => !f.all_day && new Date(f.start_at) < next && new Date(f.end_at) > date,
          )
          .map((f) => {
            // 日をまたぐ場合はこの日の範囲にクリップ (通常予定と同じ扱い)
            const s = Math.max(new Date(f.start_at).getTime(), date.getTime());
            const e = Math.min(new Date(f.end_at).getTime(), next.getTime());
            return {
              fe: f,
              top: ((s - date.getTime()) / 60000) * PX_PER_MIN,
              height: Math.max(((e - s) / 60000) * PX_PER_MIN, 20),
            };
          }),
        allDay: events.filter(
          (e) => e.all_day && new Date(e.start_at) < next && new Date(e.end_at) > date,
        ),
        allDayFeed: feedEvents.filter(
          (f) => f.all_day && new Date(f.start_at) < next && new Date(f.end_at) > date,
        ),
      });
    }
    return result;
  });

  /**
   * top/height を持つ要素群を貪欲法でカスケード状に配置する汎用ロジック。
   * 重なりグループ (cluster) ごとに列番号 (col) と列総数 (cols) を割り当て、
   * 各要素に横位置 (leftPct) を付与して返す。予定・タスク共通。
   *
   * 右の列ほど少し右にずらして手前に重ねる。等分割と違い各チップが右端まで
   * 伸びるので、重なってもタイトルが読みやすい (Google カレンダー風)。
   */
  private cascade<T extends { top: number; height: number }>(
    items: T[],
  ): (T & { col: number; leftPct: number })[] {
    const segs = items
      .map((it) => ({ ...it, col: 0, cols: 1 }))
      .sort((a, b) => a.top - b.top || b.height - a.height);

    let cluster: typeof segs = [];
    let clusterEnd = -1;
    const flush = () => {
      const nCols = Math.max(...cluster.map((s) => s.col), 0) + 1;
      cluster.forEach((s) => (s.cols = nCols));
      cluster = [];
    };
    for (const seg of segs) {
      if (cluster.length && seg.top >= clusterEnd) {
        flush();
        clusterEnd = -1;
      }
      const used = cluster.filter((s) => s.top + s.height > seg.top).map((s) => s.col);
      let col = 0;
      while (used.includes(col)) col++;
      seg.col = col;
      cluster.push(seg);
      clusterEnd = Math.max(clusterEnd, seg.top + seg.height);
    }
    if (cluster.length) flush();

    return segs.map((s) => {
      // 列ごとのずらし幅: 列数が多いほど詰める (最大でも左半分まで)
      const step = s.cols > 1 ? Math.min(50 / (s.cols - 1), 14) : 0;
      return { ...s, leftPct: step * s.col };
    });
  }

  /**
   * 予定とタスクをこの日の範囲にクリップし、両者をまとめて 1 つのカスケードに配置する。
   * 同じ時間帯に予定とタスクが重なっても、別々ではなく一緒に右へずれて被りを回避する (要件③)。
   */
  private layoutDay(
    dayEvents: EventItem[],
    dayTasks: TaskItem[],
    dayStart: Date,
    dayEnd: Date,
  ): { events: EventSeg[]; tasks: TaskSeg[] } {
    // 日をまたぐ場合はこの日の範囲にクリップして top/height を算出する
    const clip = (startIso: string, endIso: string) => {
      const s = Math.max(new Date(startIso).getTime(), dayStart.getTime());
      const e = Math.min(new Date(endIso).getTime(), dayEnd.getTime());
      return {
        top: ((s - dayStart.getTime()) / 60000) * PX_PER_MIN,
        height: Math.max(((e - s) / 60000) * PX_PER_MIN, 24),
      };
    };
    const items = [
      ...dayEvents.map((ev) => ({ ...clip(ev.start_at, ev.end_at), ev })),
      ...dayTasks.map((t) => ({ ...clip(t.start_at!, t.end_at!), task: t })),
    ];

    const eventsOut: EventSeg[] = [];
    const tasksOut: TaskSeg[] = [];
    for (const s of this.cascade(items)) {
      const left = `calc(${s.leftPct}% + 2px)`;
      const width = `calc(${100 - s.leftPct}% - 5px)`;
      const zIndex = 10 + s.col; // 右の列ほど手前に
      if ('ev' in s && s.ev) {
        eventsOut.push({ ev: s.ev, top: s.top, height: s.height, left, width, zIndex });
      } else if ('task' in s && s.task) {
        tasksOut.push({ task: s.task, top: s.top, height: s.height, left, width, zIndex });
      }
    }
    return { events: eventsOut, tasks: tasksOut };
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

  /** チップ背景: 表示色を基底色と混ぜた不透過色 (背面の罫線が透けない) */
  tint(color: string): string {
    return `color-mix(in srgb, ${color} 22%, var(--c-tile-base))`;
  }

  // ---- D&D / リサイズ (Pointer Events + setPointerCapture) ----

  dragStart(e: PointerEvent, kind: 'event' | 'task', item: EventItem | TaskItem, dayIndex: number): void {
    if (e.button !== 0) return;
    // 繰り返し予定は各回が仮想インスタンス。D&D 移動はマスター再アンカーで過去回が
    // 消えるなど直感的でないため無効化する (編集はフォームから = 全件に適用)。
    if (kind === 'event' && (item as EventItem).recurrence) return;
    e.preventDefault(); // ブラウザ既定のテキスト選択/ドラッグを抑止
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId); // 以降の pointer イベントをこの要素で受ける
    this.drag = this.buildDrag('move', kind, item, dayIndex, el, e);
  }

  resizeStart(e: PointerEvent, kind: 'event' | 'task', item: EventItem | TaskItem, dayIndex: number): void {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation(); // チップ本体の move ドラッグを発火させない
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const chip = handle.parentElement as HTMLElement;
    this.drag = this.buildDrag('resize', kind, item, dayIndex, chip, e);
  }

  private buildDrag(
    mode: 'move' | 'resize',
    kind: 'event' | 'task',
    item: EventItem | TaskItem,
    dayIndex: number,
    el: HTMLElement,
    e: PointerEvent,
  ): DragState {
    // 予定・タスクとも start_at / end_at を持つので同じ扱いにできる
    const origStart = new Date(
      kind === 'event' ? (item as EventItem).start_at : (item as TaskItem).start_at!,
    );
    const origEnd = new Date(
      kind === 'event' ? (item as EventItem).end_at : (item as TaskItem).end_at!,
    );
    const durMin = (origEnd.getTime() - origStart.getTime()) / 60_000;
    return {
      mode, kind, id: item.id, el,
      startX: e.clientX, startY: e.clientY,
      origStart, origEnd,
      origHeight: el.offsetHeight,
      durMin,
      colWidth: el.parentElement!.offsetWidth,
      dayIndex,
      nDays: this.nDays(),
      moved: false, dxDays: 0, dyMin: 0,
    };
  }

  dragMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 5) return; // 微動はクリック扱い
    d.moved = true;
    e.preventDefault();
    d.el.classList.add('dragging');
    // ドラッグ中はページ全体のテキスト選択を止める (styles.scss の body.is-dragging)
    document.body.classList.add('is-dragging');

    // 確定値 (dyMin/dxDays) は 15 分 / 1 日単位にスナップしつつ、
    // 見た目はカーソルに 1px 単位で追従させてヌルヌル動かす。
    let dyMin = Math.round(dy / PX_PER_MIN / SNAP_MIN) * SNAP_MIN;

    // リサイズ: 下端を伸縮 (予定=終了時刻 / タスク=作業時間)
    if (d.mode === 'resize') {
      dyMin = Math.max(SNAP_MIN - d.durMin, dyMin); // 最短 15 分
      d.dyMin = dyMin;
      const rawPx = Math.max(d.origHeight + dy, (SNAP_MIN - d.durMin) * PX_PER_MIN + d.origHeight);
      d.el.style.height = `${Math.max(rawPx, 16)}px`;
      return;
    }

    // 移動: 縦 = 時刻 (同日内にクランプ)、横 = 日
    const origMin = d.origStart.getHours() * 60 + d.origStart.getMinutes();
    const minDy = -origMin;
    const maxDy = 1440 - SNAP_MIN - origMin;
    dyMin = Math.max(minDy, Math.min(maxDy, dyMin));
    d.dyMin = dyMin;

    let dxDays = Math.round(dx / d.colWidth);
    dxDays = Math.max(-d.dayIndex, Math.min(d.nDays - 1 - d.dayIndex, dxDays));
    d.dxDays = dxDays;

    // 縦はカーソル追従 (クランプのみ)、横は列単位スナップ
    const rawDyPx = Math.max(minDy * PX_PER_MIN, Math.min(maxDy * PX_PER_MIN, dy));
    d.el.style.transform = `translate(${dxDays * d.colWidth}px, ${rawDyPx}px)`;
  }

  dragEnd(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    d.el.style.transform = '';
    d.el.classList.remove('dragging');
    document.body.classList.remove('is-dragging');
    if (!d.moved) return;

    // ドラッグ後に発火する click イベントを 1 回だけ無効化
    this.suppressClick = true;
    setTimeout(() => (this.suppressClick = false), 0);

    if (d.mode === 'resize') {
      // 見た目はカーソル追従なので、確定/キャンセルいずれもスナップ後の高さに戻す
      d.el.style.height = `${Math.max(d.origHeight + d.dyMin * PX_PER_MIN, 16)}px`;
      if (d.dyMin === 0) return;
      // リサイズは終了時刻を伸縮 (予定・タスク共通)
      const end = new Date(d.origEnd!.getTime() + d.dyMin * 60_000);
      if (d.kind === 'event') {
        this.api
          .updateEvent(d.id, { end_at: end.toISOString() })
          .pipe(catchError(() => { this.toast.error('リサイズに失敗しました'); return EMPTY; }))
          .subscribe((item) => this.store.syncSelected('event', item));
      } else {
        this.api
          .updateTask(d.id, { end_at: end.toISOString() })
          .pipe(catchError(() => { this.toast.error('リサイズに失敗しました'); return EMPTY; }))
          .subscribe((item) => this.store.syncSelected('task', item));
      }
      return;
    }

    const deltaMs = d.dxDays * 86_400_000 + d.dyMin * 60_000;
    if (deltaMs === 0) return;

    // 移動は開始・終了を同量シフト (予定・タスク共通)
    const start = new Date(d.origStart.getTime() + deltaMs);
    const end = new Date(d.origEnd!.getTime() + deltaMs);
    if (d.kind === 'event') {
      this.api
        .updateEvent(d.id, { start_at: start.toISOString(), end_at: end.toISOString() })
        .pipe(catchError(() => { this.toast.error('移動に失敗しました'); return EMPTY; }))
        .subscribe((item) => this.store.syncSelected('event', item));
    } else {
      this.api
        .updateTask(d.id, { start_at: start.toISOString(), end_at: end.toISOString() })
        .pipe(catchError(() => { this.toast.error('移動に失敗しました'); return EMPTY; }))
        .subscribe((item) => this.store.syncSelected('task', item));
    }
  }

  chipClick(kind: 'event' | 'task', item: EventItem | TaskItem): void {
    if (this.suppressClick) return;
    this.store.select({ kind, item } as Selected);
  }

  /** 詳細パネルで選択中 (= クリック中) のチップか判定する (選択枠 outline の表示に使う) */
  isSelected(kind: 'event' | 'task', id: number): boolean {
    const sel = this.store.selected();
    return !!sel && sel.kind === kind && sel.item.id === id;
  }

  /** チップのダブルクリックで編集フォームを開く (背面の「新規作成」は発火させない) */
  chipDblClick(kind: 'event' | 'task', item: EventItem | TaskItem, e: MouseEvent): void {
    e.stopPropagation();
    if (this.suppressClick) return;
    this.store.openForm({ kind, item });
  }

  toggleDone(task: TaskItem, ev: MouseEvent): void {
    ev.stopPropagation();
    this.api
      .updateTask(task.id, { done: !task.done })
      .pipe(catchError(() => { this.toast.error('完了状態の更新に失敗しました'); return EMPTY; }))
      .subscribe((item) => this.store.syncSelected('task', item));
  }

  // ---- ホイールナビゲーション ----
  onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.wheelNav(e.deltaY);
  }

  /** グリッド内は通常スクロールに使うため、Alt 押下時のみ日付移動 */
  onBodyWheel(e: WheelEvent): void {
    if (!e.altKey) return;
    e.preventDefault();
    this.wheelNav(e.deltaY);
  }

  private wheelNav(deltaY: number): void {
    const now = Date.now();
    if (now - this.lastWheel < 200) return;
    this.lastWheel = now;
    this.store.navigate(deltaY > 0 ? 1 : -1);
  }

  timeRange(ev: EventItem): string {
    return `${fmtTime(new Date(ev.start_at))} – ${fmtTime(new Date(ev.end_at))}`;
  }

  gotoDay(date: Date): void {
    this.store.anchor.set(startOfDay(date));
    this.store.setView('day');
  }

  /** 空きスペースのダブルクリック位置から時刻を割り出して新規作成 */
  newEventAt(date: Date, ev: MouseEvent): void {
    const target = ev.currentTarget as HTMLElement;
    const y = ev.clientY - target.getBoundingClientRect().top;
    const hour = Math.max(0, Math.min(23, Math.floor(y / (60 * PX_PER_MIN))));
    const start = new Date(date);
    start.setHours(hour, 0, 0, 0);
    this.store.openForm({ kind: 'event', prefillStart: start });
  }

  private calcNow(): number {
    const now = new Date();
    return (now.getHours() * 60 + now.getMinutes()) * PX_PER_MIN;
  }

  ngAfterViewInit(): void {
    // 初期表示で 8:00 までスクロールしておく
    this.scrollRef?.nativeElement.scrollTo({ top: 8 * 60 * PX_PER_MIN });
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }
}
