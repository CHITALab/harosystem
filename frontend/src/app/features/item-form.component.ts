/**
 * 作成/編集フォーム — <ui-modal> 上に表示する。
 *   - store.form() の状態 (新規 or 編集 / 予定 or タスク) を ngOnInit で読み込む
 *   - 予定: 開始/終了/終日、タスク: 期限/作業時間/完了
 *   - 内容は Markdown / Text を選択可能
 * 保存成功時は store.afterMutation で詳細パネルとカレンダーを同期する。
 */
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { ToastService } from '../core/toast.service';
import { catchError, tap, EMPTY } from 'rxjs';
import { SettingsService } from '../core/settings.service';
import { StoreService } from '../core/store.service';
import { EventItem, TaskItem } from '../core/models';
import { addDays, toLocalInput } from '../core/util';
import {
  RecurInput,
  WEEKDAY_CODES,
  WEEKDAY_LABELS,
  buildRRule,
  emptyRecur,
  parseRRule,
} from '../core/recurrence';
import { UiButtonComponent } from '../ui/button.component';
import { UiColorPaletteComponent } from '../ui/color-palette.component';
import { UiFormFieldComponent } from '../ui/form-field.component';
import { UiModalComponent } from '../ui/modal.component';

@Component({
  selector: 'app-item-form',
  standalone: true,
  imports: [
    FormsModule,
    UiButtonComponent,
    UiColorPaletteComponent,
    UiFormFieldComponent,
    UiModalComponent,
  ],
  template: `
    <ui-modal
      [title]="(isEdit ? '// EDIT ' : '// NEW ') + (kind === 'event' ? 'EVENT' : 'TASK')"
      (closed)="store.closeForm()"
    >
      <!-- 新規作成時のみ種別を選べる -->
      @if (!isEdit) {
        <div class="flex gap-2">
          <ui-button [active]="kind === 'event'" (click)="kind = 'event'">予定</ui-button>
          <ui-button [active]="kind === 'task'" (click)="kind = 'task'">タスク</ui-button>
        </div>
      }

      <ui-form-field label="タイトル">
        <input type="text" class="input" [(ngModel)]="title" placeholder="title" />
      </ui-form-field>

      @if (kind === 'event') {
        <div class="flex gap-3">
          <ui-form-field label="開始">
            <input type="datetime-local" class="input" [(ngModel)]="startAt" />
          </ui-form-field>
          <ui-form-field label="終了">
            <input type="datetime-local" class="input" [(ngModel)]="endAt" />
          </ui-form-field>
        </div>
        <label class="flex items-center gap-2 text-sm cursor-pointer select-none w-fit">
          <input type="checkbox" [(ngModel)]="allDay" /> 終日
        </label>

        <!-- 繰り返し (RRULE プリセット) -->
        <div class="flex flex-col gap-2">
          <ui-form-field label="繰り返し">
            <select class="input" [(ngModel)]="recur.freq">
              <option value="none">なし</option>
              <option value="daily">毎日</option>
              <option value="weekday">平日のみ (月〜金)</option>
              <option value="weekly">毎週 (曜日指定)</option>
              <option value="monthly">毎月</option>
            </select>
          </ui-form-field>

          @if (recur.freq === 'weekly') {
            <div class="flex gap-1 flex-wrap">
              @for (code of weekdayCodes; track code) {
                <button type="button" class="text-xs px-2 py-1 border"
                  [class.border-cyber-cyan]="recur.days.includes(code)"
                  [class.text-cyber-cyan]="recur.days.includes(code)"
                  [class.border-cyber-line]="!recur.days.includes(code)"
                  (click)="toggleDay(code)">{{ weekdayLabels[code] }}</button>
              }
            </div>
          }

          @if (recur.freq !== 'none') {
            <div class="flex gap-3 items-end flex-wrap">
              <ui-form-field label="終了">
                <select class="input" [(ngModel)]="recur.end">
                  <option value="never">なし (無期限)</option>
                  <option value="count">回数</option>
                  <option value="until">期日</option>
                </select>
              </ui-form-field>
              @if (recur.end === 'count') {
                <ui-form-field label="回数">
                  <input type="number" class="input" min="1" max="365" [(ngModel)]="recur.count" />
                </ui-form-field>
              }
              @if (recur.end === 'until') {
                <ui-form-field label="終了日">
                  <input type="date" class="input" [(ngModel)]="recur.until" />
                </ui-form-field>
              }
            </div>
          }
        </div>
      } @else {
        <div class="flex gap-3 items-end">
          <ui-form-field label="開始">
            <input type="datetime-local" class="input" [(ngModel)]="startAt" />
          </ui-form-field>
          <ui-form-field label="終了">
            <input type="datetime-local" class="input" [(ngModel)]="endAt" />
          </ui-form-field>
          <label class="flex items-center gap-2 text-sm cursor-pointer select-none pb-2.5
                        whitespace-nowrap">
            <input type="checkbox" [(ngModel)]="done" /> 完了
          </label>
        </div>
        <p class="text-xs text-cyber-dim -mt-1">開始/終了を空にするとバックログ（未スケジュール）になります</p>
        <!-- ノート紐付け (タスクのみ。ノートが 1 件以上あるときだけ表示) -->
        @if (store.notes().length) {
          <ui-form-field label="ノート">
            <select class="input" [(ngModel)]="noteId">
              <option [ngValue]="null">— なし —</option>
              @for (note of store.notes(); track note.id) {
                <option [ngValue]="note.id">{{ note.title }}</option>
              }
            </select>
          </ui-form-field>
        }
      }

      <div class="flex gap-3">
        <ui-form-field label="ラベル">
          <select class="input" [(ngModel)]="labelId" (ngModelChange)="onLabelChange($event)">
            <option [ngValue]="null">— なし —</option>
            @for (label of store.labels(); track label.id) {
              <option [ngValue]="label.id">{{ label.name }}</option>
            }
          </select>
        </ui-form-field>
        <ui-form-field label="形式">
          <div class="flex gap-2">
            <ui-button [active]="contentType === 'md'" (click)="contentType = 'md'">
              Markdown
            </ui-button>
            <ui-button [active]="contentType === 'text'" (click)="contentType = 'text'">
              Text
            </ui-button>
          </div>
        </ui-form-field>
      </div>

      <!-- 個別色 (未指定ならラベル色 → 既定色の順で表示に使われる) -->
      <div class="flex gap-5 items-center flex-wrap">
        <label class="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input type="checkbox" [(ngModel)]="useColor" /> タイルの色を指定
        </label>
        @if (useColor) {
          <ui-color-palette [value]="color" (valueChange)="color = $event" />
        }
      </div>

      <!-- 通知 (開始/期限の何分前に知らせるか) -->
      <div class="flex gap-5 items-center flex-wrap">
        <label class="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input type="checkbox" [(ngModel)]="notifyEnabled" />
          通知する (開始前)
        </label>
        @if (notifyEnabled) {
          <select class="input !w-auto" [(ngModel)]="notifyBeforeMin">
            @for (opt of notifyOptions; track opt.value) {
              <option [ngValue]="opt.value">{{ opt.label }}</option>
            }
          </select>
        }
      </div>

      <ui-form-field [label]="'内容 (' + contentType + ')'">
        <textarea
          class="input min-h-[180px] resize-y leading-relaxed"
          [(ngModel)]="content"
          [placeholder]="contentType === 'md'
            ? '# 見出し / - リスト / - [ ] チェックリスト / **強調** など'
            : 'プレーンテキスト'"
        ></textarea>
      </ui-form-field>

      <div class="flex justify-end gap-2 pt-1">
        <ui-button (click)="store.closeForm()">Cancel</ui-button>
        <ui-button variant="primary" [disabled]="!title.trim()" (click)="save()">
          Save
        </ui-button>
      </div>
    </ui-modal>
  `,
})
export class ItemFormComponent implements OnInit {
  store = inject(StoreService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private settings = inject(SettingsService);

  kind: 'event' | 'task' = 'event';
  isEdit = false;
  private editId: number | null = null;

  /** 通知タイミングの選択肢 */
  notifyOptions = [
    { value: 0, label: '開始時刻ちょうど' },
    { value: 5, label: '5 分前' },
    { value: 10, label: '10 分前' },
    { value: 15, label: '15 分前' },
    { value: 30, label: '30 分前' },
    { value: 60, label: '1 時間前' },
    { value: 1440, label: '1 日前' },
  ];

  // フォーム入力値 (datetime-local は "YYYY-MM-DDTHH:mm" 文字列で扱う)
  title = '';
  content = '';
  contentType: 'md' | 'text' = 'md';
  startAt = '';
  endAt = '';
  allDay = false;
  done = false;
  // 繰り返し (予定のみ)
  recur: RecurInput = emptyRecur();
  readonly weekdayCodes = WEEKDAY_CODES;
  readonly weekdayLabels = WEEKDAY_LABELS;
  labelId: number | null = null;
  noteId: number | null = null; // タスクのみ: 紐付くノート
  // ボード/バックログからの新規作成で渡されるカンバン状態・スプリント (タスクのみ)
  private prefillStatus?: 'backlog' | 'todo' | 'in_progress' | 'done';
  private prefillSprintId: number | null = null;
  useColor = false;
  color = '#00f0ff';
  notifyEnabled = false;
  notifyBeforeMin = 10;

  /** store.form() の状態から初期値を組み立てる */
  ngOnInit(): void {
    const state = this.store.form();
    if (!state) return;
    this.kind = state.kind;

    if (state.item) {
      // 編集: 既存アイテムの値をフォームへ展開
      this.isEdit = true;
      this.editId = state.item.id;
      this.title = state.item.title;
      this.content = state.item.content;
      this.contentType = state.item.content_type;
      this.labelId = state.item.label_id;
      this.useColor = !!state.item.color;
      this.color = state.item.color ?? '#00f0ff';
      this.notifyEnabled = state.item.notify_enabled;
      this.notifyBeforeMin = state.item.notify_before_min;
      if (state.kind === 'event') {
        const ev = state.item as EventItem;
        this.startAt = toLocalInput(new Date(ev.start_at));
        this.endAt = toLocalInput(new Date(ev.end_at));
        this.allDay = ev.all_day;
        this.recur = parseRRule(ev.recurrence);
        // 繰り返し予定は一覧で展開された「各回」なので、編集はマスターに対して行う。
        // マスターの開始/終了を取り直して再アンカー (過去回の消失) を防ぐ。
        if (ev.recurrence) {
          this.api.getEvent(ev.id).pipe(
            catchError(() => {
              this.toast.error('繰り返し予定の読み込みに失敗しました');
              return EMPTY;
            }),
          ).subscribe((master) => {
            this.startAt = toLocalInput(new Date(master.start_at));
            this.endAt = toLocalInput(new Date(master.end_at));
            this.recur = parseRRule(master.recurrence);
          });
        }
      } else {
        const task = state.item as TaskItem;
        this.startAt = task.start_at ? toLocalInput(new Date(task.start_at)) : '';
        this.endAt = task.end_at ? toLocalInput(new Date(task.end_at)) : '';
        this.done = task.done;
        this.noteId = task.note_id;
      }
    } else {
      // 新規。ボード/バックログからの作成はカンバン状態・スプリント・ラベルを引き継ぐ
      this.prefillStatus = state.prefillStatus;
      this.prefillSprintId = state.prefillSprintId ?? null;
      if (state.prefillLabelId !== undefined) this.labelId = state.prefillLabelId;
      if (state.prefillStatus) {
        // ボード作成: 時刻は未設定 (未スケジュール) で開始する
        this.startAt = '';
        this.endAt = '';
      } else {
        // カレンダー作成: ダブルクリック位置 (prefillStart) か既定時刻を初期値にする
        const base = state.prefillStart ?? this.defaultStart();
        this.startAt = toLocalInput(base);
        const end = new Date(base);
        end.setHours(end.getHours() + 1);
        this.endAt = toLocalInput(end);
      }
      // 通知の初期値: ラベル既定 > ユーザー設定 (新規時はラベル未選択なのでユーザー設定)
      this.applyNotifyDefaults();
    }
  }

  /** ラベル変更時 (新規作成のみ): 通知の初期値をラベル既定に追従させる */
  onLabelChange(labelId: number | null): void {
    if (this.isEdit) return; // 編集時は既存の通知設定を上書きしない
    this.applyNotifyDefaults(labelId);
  }

  /** 通知の初期値を「選択中ラベルの既定 > ユーザー設定」の優先順で適用する */
  private applyNotifyDefaults(labelId: number | null = this.labelId): void {
    const label = this.store.labels().find((l) => l.id === labelId);
    if (label) {
      this.notifyEnabled = label.notify_default;
      this.notifyBeforeMin = label.notify_before_min_default;
    } else {
      const s = this.settings.settings();
      this.notifyEnabled = s.notifyDefault;
      this.notifyBeforeMin = s.notifyBeforeMin;
    }
  }

  /** 毎週の曜日選択をトグルする */
  toggleDay(code: string): void {
    this.recur.days = this.recur.days.includes(code)
      ? this.recur.days.filter((d) => d !== code)
      : [...this.recur.days, code];
  }

  /** 既定の開始時刻: 表示中の日の「現在時刻 + 1時間 (0分)」 */
  private defaultStart(): Date {
    const d = new Date(this.store.anchor());
    const now = new Date();
    d.setHours(now.getHours() + 1, 0, 0, 0);
    return d;
  }

  save(): void {
    if (!this.title.trim()) return;
    if (this.kind === 'event') {
      let start = new Date(this.startAt);
      let end = new Date(this.endAt);
      if (this.allDay) {
        // 終日: 日付境界に丸める (終了は翌日 0:00 = 排他的)
        start = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        end = addDays(new Date(end.getFullYear(), end.getMonth(), end.getDate()), 1);
      }
      if (end <= start) {
        this.toast.error('終了は開始より後にしてください');
        return;
      }
      const payload: Partial<EventItem> = {
        title: this.title.trim(),
        content: this.content,
        content_type: this.contentType,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        all_day: this.allDay,
        label_id: this.labelId,
        color: this.useColor ? this.color : null,
        notify_enabled: this.notifyEnabled,
        notify_before_min: this.notifyBeforeMin,
        // 繰り返しルール (マスター開始日の曜日を毎週の既定に使う)
        recurrence: buildRRule(this.recur, start.getDay()),
      };
      const req = this.isEdit
        ? this.api.updateEvent(this.editId!, payload)
        : this.api.createEvent(payload);
      req.pipe(
        tap(() => this.store.closeForm()),
        catchError(() => {
          this.toast.error('予定の保存に失敗しました');
          return EMPTY;
        }),
      ).subscribe((item) => {
        this.store.afterMutation({ kind: 'event', item });
      });
    } else {
      // 開始/終了は「両方入力 (スケジュール)」か「両方空 (未スケジュール=バックログ)」のいずれか
      const hasStart = !!this.startAt;
      const hasEnd = !!this.endAt;
      if (hasStart !== hasEnd) {
        this.toast.error('開始と終了は両方入力するか、両方空にしてください');
        return;
      }
      let startIso: string | null = null;
      let endIso: string | null = null;
      if (hasStart && hasEnd) {
        const s = new Date(this.startAt);
        const e = new Date(this.endAt);
        if (e <= s) {
          this.toast.error('終了は開始より後にしてください');
          return;
        }
        startIso = s.toISOString();
        endIso = e.toISOString();
      }
      const payload: Partial<TaskItem> = {
        title: this.title.trim(),
        content: this.content,
        content_type: this.contentType,
        start_at: startIso,
        end_at: endIso,
        done: this.done,
        label_id: this.labelId,
        note_id: this.noteId,
        color: this.useColor ? this.color : null,
        notify_enabled: this.notifyEnabled,
        notify_before_min: this.notifyBeforeMin,
      };
      // ボード/バックログからの新規作成のみ status/sprint_id を明示送信する。
      // (通常のカレンダー作成では未送信にして、時刻未定なら自動 backlog に任せる)
      if (!this.isEdit && this.prefillStatus) {
        payload.status = this.prefillStatus;
        payload.sprint_id = this.prefillSprintId;
      }
      const req = this.isEdit
        ? this.api.updateTask(this.editId!, payload)
        : this.api.createTask(payload);
      req.pipe(
        tap(() => this.store.closeForm()),
        catchError(() => {
          this.toast.error('タスクの保存に失敗しました');
          return EMPTY;
        }),
      ).subscribe((item) => {
        this.store.afterMutation({ kind: 'task', item });
      });
    }
  }
}
