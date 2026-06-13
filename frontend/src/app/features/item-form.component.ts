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
      } @else {
        <div class="flex gap-3 items-end">
          <ui-form-field label="期限">
            <input type="datetime-local" class="input" [(ngModel)]="dueAt" />
          </ui-form-field>
          <ui-form-field label="作業時間 (分)">
            <input type="number" class="input" min="0" step="15"
                   [(ngModel)]="duration" placeholder="例: 60" />
          </ui-form-field>
          <label class="flex items-center gap-2 text-sm cursor-pointer select-none pb-2.5
                        whitespace-nowrap">
            <input type="checkbox" [(ngModel)]="done" /> 完了
          </label>
        </div>
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
          通知する ({{ kind === 'event' ? '開始' : '期限' }}前)
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
  dueAt = '';
  duration: number | null = null;
  done = false;
  labelId: number | null = null;
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
      } else {
        const task = state.item as TaskItem;
        this.dueAt = task.due_at ? toLocalInput(new Date(task.due_at)) : '';
        this.duration = task.duration_min;
        this.done = task.done;
      }
    } else {
      // 新規: ダブルクリック位置 (prefillStart) か既定時刻を初期値にする
      const base = state.prefillStart ?? this.defaultStart();
      this.startAt = toLocalInput(base);
      const end = new Date(base);
      end.setHours(end.getHours() + 1);
      this.endAt = toLocalInput(end);
      this.dueAt = toLocalInput(base);
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
      const payload: Partial<TaskItem> = {
        title: this.title.trim(),
        content: this.content,
        content_type: this.contentType,
        due_at: this.dueAt ? new Date(this.dueAt).toISOString() : null,
        duration_min: this.duration ? Number(this.duration) : null,
        done: this.done,
        label_id: this.labelId,
        color: this.useColor ? this.color : null,
        notify_enabled: this.notifyEnabled,
        notify_before_min: this.notifyBeforeMin,
      };
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
