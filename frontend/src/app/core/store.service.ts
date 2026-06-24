/**
 * 状態層 — Angular Signals + RxJS ストリーム処理。
 *
 * アプリ全体の UI 状態 (表示モード/基準日/取得済みデータ/選択中アイテム…) を
 * signal で保持し、派生値 (表示範囲・タイトル) は computed で導出する。
 * コンポーネントはこのストアを inject してテンプレートから signal を読むだけで、
 * 値の変更時に自動で再描画される。
 *
 * データフロー (3 層):
 *   ① HttpClient   — サーバーとの通信 (Observable<T> を返す)
 *   ② RxJS pipe     — ストリームの整形・合成・エラー処理
 *   ③ Signal        — テンプレートへの反映 (signal.set で描画トリガー)
 *
 * 具体的な流れ:
 *   ユーザー操作 -> Store のメソッド
 *     -> XxxApiService(HttpClient) が Observable を返す
 *       -> pipe(forkJoin / map / catchError 等) でストリームを整形
 *         -> subscribe 内で signal.set() -> テンプレートが自動再描画
 */
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { forkJoin, of, EMPTY, catchError, tap } from 'rxjs';
import { ApiService } from './api.service';
import { ToastService } from './toast.service';
import {
  EventItem,
  Feed,
  FeedEvent,
  FormState,
  Label,
  Note,
  Selected,
  TaskItem,
  ViewMode,
} from './models';
import { addDays, startOfDay, startOfWeek, utcDateToLocalIso, WEEKDAYS_JA } from './util';

/** 非表示フィード ID の localStorage キー (ブラウザごとの表示設定) */
const HIDDEN_FEEDS_KEY = 'neon-cal-hidden-feeds';
/** board/backlog で選択中のラベルを記憶する localStorage キー */
const BOARD_LABEL_KEY = 'neon-cal-board-label';

@Injectable({ providedIn: 'root' })
export class StoreService {
  private api = inject(ApiService);
  private toast = inject(ToastService);

  // ---- 基本状態 (writable signals) ----
  readonly viewMode = signal<ViewMode>('week');
  /** 表示の基準日 (日: その日 / 週: その週 / 月: その月) */
  readonly anchor = signal<Date>(startOfDay(new Date()));
  readonly labels = signal<Label[]>([]);
  readonly events = signal<EventItem[]>([]);
  readonly tasks = signal<TaskItem[]>([]);
  /** ノート一覧 (ノートページ表示・タスクフォームのノート選択で共有) */
  readonly notes = signal<Note[]>([]);
  /** ラベル絞り込み (null = すべて) */
  readonly filterLabelId = signal<number | null>(null);
  /** 詳細パネルに表示中のアイテム (null = パネル非表示) */
  readonly selected = signal<Selected | null>(null);
  /** 作成/編集モーダルの状態 (null = モーダル非表示) */
  readonly form = signal<FormState | null>(null);
  /**
   * タスク変更の世代カウンタ。afterMutation/syncSelected で増加する。
   * ボード/バックログ画面が独自に保持するタスク一覧を、共有の詳細パネル・
   * 作成フォーム経由の変更に追従して再取得するためのトリガー。
   */
  readonly tasksVersion = signal(0);
  /** 外部カレンダー購読の一覧 */
  readonly feeds = signal<Feed[]>([]);
  /** 購読フィードから取り込まれた予定 (読み取り専用表示) */
  readonly feedEvents = signal<FeedEvent[]>([]);
  /** 非表示にしているフィードの ID (サイドバーのトグルで切替・localStorage 永続化) */
  readonly hiddenFeedIds = signal<ReadonlySet<number>>(this.loadHiddenFeeds());
  /**
   * board/backlog で選択中のラベル (null = 未分類)。両画面で共有し、画面遷移・リロードを
   * またいで保持する (localStorage 永続化)。コンポーネントローカルに持つと遷移で失われるため。
   */
  readonly boardLabelId = signal<number | null>(this.loadBoardLabel());

  constructor() {
    // boardLabelId の変化を localStorage に書き戻す (リロード後も選択を保持)。
    // Safari プライベートモード等で setItem が SecurityError を投げても effect を壊さない。
    effect(() => {
      const v = this.boardLabelId();
      try {
        localStorage.setItem(BOARD_LABEL_KEY, v === null ? 'null' : String(v));
      } catch {
        /* ストレージ不可の環境では永続化を諦める (動作には影響しない) */
      }
    });
  }

  // ---- 派生状態 (computed signals) ----

  /**
   * カレンダーに描画するフィード予定。
   *   - 非表示フィードを除外する
   *   - 終日予定は UTC の年月日をローカル日付に正規化する
   *     (ICS の DATE 型は UTC 0:00 で保存されるため、そのままでは JST で 1 日ズレる)
   */
  readonly visibleFeedEvents = computed<FeedEvent[]>(() => {
    const hidden = this.hiddenFeedIds();
    return this.feedEvents()
      .filter((f) => !hidden.has(f.feed_id))
      .map((f) =>
        f.all_day
          ? { ...f, start_at: utcDateToLocalIso(f.start_at), end_at: utcDateToLocalIso(f.end_at) }
          : f,
      );
  });

  /** 現在表示している期間 [start, end)。viewMode と anchor から自動算出 */
  readonly range = computed<[Date, Date]>(() => {
    const a = this.anchor();
    switch (this.viewMode()) {
      case 'day':
        return [a, addDays(a, 1)];
      case 'week': {
        const s = startOfWeek(a);
        return [s, addDays(s, 7)];
      }
      case 'month': {
        // 月ビューは「1日を含む週の日曜」から 6 週間 (42 日) を表示する
        const first = new Date(a.getFullYear(), a.getMonth(), 1);
        const s = startOfWeek(first);
        return [s, addDays(s, 42)];
      }
    }
  });

  /** ヘッダーに表示する期間タイトル */
  readonly title = computed(() => {
    const a = this.anchor();
    const y = a.getFullYear();
    const m = a.getMonth() + 1;
    switch (this.viewMode()) {
      case 'day':
        return `${y}年${m}月${a.getDate()}日 (${WEEKDAYS_JA[a.getDay()]})`;
      case 'week': {
        const [s, e0] = this.range();
        const e = addDays(e0, -1);
        return `${s.getFullYear()}年${s.getMonth() + 1}月${s.getDate()}日 – ${e.getMonth() + 1}月${e.getDate()}日`;
      }
      case 'month':
        return `${y}年${m}月`;
    }
  });

  // ---- アクション ----

  /**
   * 表示範囲のデータをサーバーから再取得する。
   *
   * forkJoin で 3 つのリクエストを並行実行し、
   * 全完了後に signal を一括更新する。
   * エラー時はトースト通知し、画面はそのまま維持する。
   */
  reload(): void {
    const [start, end] = this.range();
    const labelId = this.filterLabelId();

    forkJoin({
      events: this.api.getEvents(start, end, labelId).pipe(catchError(() => of([] as EventItem[]))),
      tasks:  this.api.getTasks(start, end, labelId).pipe(catchError(() => of([] as TaskItem[]))),
      feeds:  this.api.getFeedEvents(start, end).pipe(catchError(() => of([] as FeedEvent[]))),
    }).pipe(
      catchError(() => {
        this.toast.error('データの取得に失敗しました');
        return EMPTY;
      }),
    ).subscribe(({ events, tasks, feeds }) => {
      this.events.set(events);
      this.tasks.set(tasks);
      this.feedEvents.set(feeds);
    });
  }

  /** ラベル一覧を取得して signal に反映する */
  loadLabels(): void {
    this.api.getLabels().pipe(
      catchError(() => {
        this.toast.error('ラベルの取得に失敗しました');
        return of([] as Label[]);
      }),
    ).subscribe((l) => this.labels.set(l));
  }

  /** ノート一覧を取得して signal に反映する */
  loadNotes(): void {
    this.api.getNotes().pipe(
      catchError(() => {
        this.toast.error('ノートの取得に失敗しました');
        return of([] as Note[]);
      }),
    ).subscribe((n) => this.notes.set(n));
  }

  /** フィード一覧を取得して signal に反映する */
  loadFeeds(): void {
    this.api.getFeeds().pipe(
      catchError(() => {
        this.toast.error('フィードの取得に失敗しました');
        return of([] as Feed[]);
      }),
    ).subscribe((f) => this.feeds.set(f));
  }

  setView(mode: ViewMode): void {
    this.viewMode.set(mode);
    this.reload();
  }

  /** -1: 前へ / 0: 今日へ / 1: 次へ */
  navigate(dir: -1 | 0 | 1): void {
    if (dir === 0) {
      this.anchor.set(startOfDay(new Date()));
    } else {
      const a = this.anchor();
      switch (this.viewMode()) {
        case 'day':
          this.anchor.set(addDays(a, dir));
          break;
        case 'week':
          this.anchor.set(addDays(a, dir * 7));
          break;
        case 'month':
          this.anchor.set(new Date(a.getFullYear(), a.getMonth() + dir, 1));
          break;
      }
    }
    this.reload();
  }

  /** フィードの表示/非表示を切り替えて localStorage に保存する */
  toggleFeedVisibility(feedId: number): void {
    const next = new Set(this.hiddenFeedIds());
    if (next.has(feedId)) {
      next.delete(feedId);
    } else {
      next.add(feedId);
    }
    this.hiddenFeedIds.set(next);
    localStorage.setItem(HIDDEN_FEEDS_KEY, JSON.stringify([...next]));
  }

  private loadHiddenFeeds(): Set<number> {
    try {
      return new Set(JSON.parse(localStorage.getItem(HIDDEN_FEEDS_KEY) ?? '[]'));
    } catch {
      return new Set();
    }
  }

  /** 保存済みの board/backlog 選択ラベルを読む (なし/未分類/ストレージ不可 = null) */
  private loadBoardLabel(): number | null {
    try {
      const raw = localStorage.getItem(BOARD_LABEL_KEY);
      if (raw === null || raw === 'null') return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  /** 同じラベルをもう一度クリックすると絞り込み解除 */
  setFilter(labelId: number | null): void {
    this.filterLabelId.set(this.filterLabelId() === labelId ? null : labelId);
    this.reload();
  }

  select(sel: Selected | null): void {
    this.selected.set(sel);
  }

  openForm(state: FormState): void {
    this.form.set(state);
  }

  closeForm(): void {
    this.form.set(null);
  }

  /**
   * 更新系 API 成功後の共通処理。
   * @param updated 詳細パネルへ反映する最新アイテム
   *                (undefined = 選択は変えずデータのみ再取得 / null = パネルを閉じる)
   */
  afterMutation(updated?: Selected | null): void {
    if (updated !== undefined) this.selected.set(updated);
    this.tasksVersion.update((v) => v + 1); // ボード/バックログに変更を通知
    this.reload();
  }

  /**
   * 更新後のアイテムが詳細パネルで選択中ならパネルも同期し、データを再取得する。
   * D&D・チェックボックスなど「パネル外からの更新」で使う。
   */
  syncSelected(kind: 'event' | 'task', item: EventItem | TaskItem): void {
    const sel = this.selected();
    if (sel && sel.kind === kind && sel.item.id === item.id) {
      this.afterMutation({ kind, item } as Selected); // 内部で tasksVersion を更新
    } else {
      this.tasksVersion.update((v) => v + 1);
      this.reload();
    }
  }
}
