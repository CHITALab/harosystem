/**
 * 設定ページ ("/settings") — カレンダーとは別ページとしてレンダリングする。
 *   1. ユーザー設定         : 表示名 / 既定ビュー / 自動更新間隔 (localStorage 保存)
 *   2. 通知設定             : 新規作成時の既定 ON/OFF・タイミング / ブラウザ通知の許可
 *   3. プロジェクト         : ラベルの名前 / 既定色 / 既定通知設定の編集
 *   4. 通知の送信先         : Discord / Slack Webhook の管理 (テスト送信つき)
 *   5. インポート/エクスポート : iCalendar (.ics) 形式の取り込みとダウンロード
 *   6. 外部カレンダー共有     : ICS URL を購読して表示 (同期エラーも表示)
 *
 * 実装メモ:
 *   - 操作結果はすべて ToastService で通知する
 *   - 有効/無効スイッチは Angular Material (mat-slide-toggle)
 */
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApiService, ICS_EXPORT_URL } from '../core/api.service';
import { NotificationService } from '../core/notification.service';
import { SettingsService } from '../core/settings.service';
import { DARK_THEMES, LIGHT_THEMES, ThemeMode } from '../core/theme.service';
import { StoreService } from '../core/store.service';
import { ToastService } from '../core/toast.service';
import { Feed, Label, ViewMode, Webhook } from '../core/models';
import { fmtDateTime } from '../core/util';
import { UiButtonComponent } from '../ui/button.component';
import { UiColorPaletteComponent } from '../ui/color-palette.component';
import { UiFormFieldComponent } from '../ui/form-field.component';

/** セクション見出しの共通クラス */
const HEAD =
  'font-head text-sm tracking-[3px] uppercase text-cyber-magenta ' +
  'drop-shadow-[0_0_8px_rgb(var(--c-magenta)/0.6)] border-b border-cyber-line pb-1.5 mb-3';

@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    MatSlideToggleModule,
    MatTooltipModule,
    UiButtonComponent,
    UiColorPaletteComponent,
    UiFormFieldComponent,
  ],
  host: { class: 'block h-screen overflow-y-auto' },
  template: `
    <div class="max-w-[760px] mx-auto p-6 flex flex-col gap-8">
      <!-- ヘッダー: 戻るリンク -->
      <div class="flex items-center gap-4">
        <a
          routerLink="/"
          class="text-3xl leading-none text-cyber-dim hover:text-cyber-cyan p-1
                 transition-all"
          title="カレンダーへ戻る"
        >←</a>
        <h1 class="font-head text-[20px] tracking-[3px] text-cyber-cyan
                   drop-shadow-[0_0_10px_rgb(var(--c-cyan)/0.5)]">// SETTINGS</h1>
      </div>

      <!-- 1. ユーザー設定 -->
      <section>
        <div [class]="head">// User</div>
        <div class="flex flex-col gap-3">
          <ui-form-field label="表示名">
            <input type="text" class="input" placeholder="名前 (ヘッダーに表示)"
                   [ngModel]="settings.settings().userName"
                   (ngModelChange)="settings.update({ userName: $event })" />
          </ui-form-field>
          <ui-form-field label="起動時の表示">
            <div class="flex gap-2">
              @for (m of viewModes; track m.value) {
                <ui-button
                  [active]="settings.settings().defaultView === m.value"
                  (click)="settings.update({ defaultView: m.value })"
                >{{ m.label }}</ui-button>
              }
            </div>
          </ui-form-field>
          <ui-form-field label="自動更新間隔">
            <select class="input"
                    [ngModel]="settings.settings().autoRefreshSec"
                    (ngModelChange)="settings.update({ autoRefreshSec: +$event })">
              <option [ngValue]="0">なし</option>
              <option [ngValue]="30">30 秒</option>
              <option [ngValue]="60">1 分</option>
              <option [ngValue]="300">5 分</option>
            </select>
          </ui-form-field>
        </div>
      </section>

      <!-- 1.5. 外観 (モード / テーマ) -->
      <section>
        <div [class]="head">// Appearance</div>
        <div class="flex flex-col gap-3">
          <ui-form-field label="モード">
            <div class="flex gap-2">
              @for (m of themeModes; track m.value) {
                <ui-button
                  [active]="settings.settings().themeMode === m.value"
                  (click)="settings.update({ themeMode: m.value })"
                >{{ m.label }}</ui-button>
              }
            </div>
          </ui-form-field>
          <div class="flex gap-3 flex-wrap">
            <ui-form-field label="ダークモードのテーマ">
              <select class="input"
                      [ngModel]="settings.settings().darkTheme"
                      (ngModelChange)="settings.update({ darkTheme: $event })">
                @for (t of darkThemes; track t.id) {
                  <option [ngValue]="t.id">{{ t.name }}</option>
                }
              </select>
            </ui-form-field>
            <ui-form-field label="ライトモードのテーマ">
              <select class="input"
                      [ngModel]="settings.settings().lightTheme"
                      (ngModelChange)="settings.update({ lightTheme: $event })">
                @for (t of lightThemes; track t.id) {
                  <option [ngValue]="t.id">{{ t.name }}</option>
                }
              </select>
            </ui-form-field>
          </div>
          <p class="text-xs text-cyber-dim">
            「システム」は OS のライト/ダーク設定に自動で追従します。
            テーマは各モードごとに保存されます。
          </p>
        </div>
      </section>

      <!-- 2. 通知設定 -->
      <section>
        <div [class]="head">// Notifications</div>
        <div class="flex flex-col gap-3">
          <div class="flex items-center gap-3">
            <mat-slide-toggle
              [checked]="settings.settings().notifyDefault"
              (change)="settings.update({ notifyDefault: $event.checked })"
            />
            <span class="text-sm">新規の予定/タスクで通知を既定 ON にする</span>
          </div>
          <ui-form-field label="既定の通知タイミング">
            <select class="input"
                    [ngModel]="settings.settings().notifyBeforeMin"
                    (ngModelChange)="settings.update({ notifyBeforeMin: +$event })">
              @for (o of notifyOptions; track o.min) {
                <option [ngValue]="o.min">{{ o.label }}</option>
              }
            </select>
          </ui-form-field>
          <div class="flex items-center gap-3">
            <ui-button (click)="enableBrowserNotify()">ブラウザ通知を許可する</ui-button>
            <span class="text-xs text-cyber-dim">{{ permissionLabel() }}</span>
          </div>
          <p class="text-xs text-cyber-dim">
            アプリを開いている間は画面上に通知されます。閉じている間も通知したい場合は
            下の Webhook (Discord / Slack) を登録してください。
          </p>
        </div>
      </section>

      <!-- 3. プロジェクト (ラベル) の編集 -->
      <section>
        <div [class]="head">// Projects (Labels)</div>
        @for (label of store.labels(); track label.id) {
          @if (editLabelId === label.id) {
            <!-- 編集モード: 名前 / 既定色 / 既定通知 -->
            <div class="flex flex-col gap-2.5 px-2.5 py-3 border-b border-cyber-line">
              <ui-form-field label="プロジェクト名">
                <input type="text" class="input !py-1.5" [(ngModel)]="editName"
                       (keyup.enter)="saveLabel(label)" />
              </ui-form-field>
              <ui-form-field label="既定の色">
                <ui-color-palette [value]="editColor" (valueChange)="editColor = $event" />
              </ui-form-field>
              <div class="flex items-center gap-3 flex-wrap">
                <label class="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input type="checkbox" [(ngModel)]="editNotify" />
                  新規作成時に通知を既定 ON にする
                </label>
                @if (editNotify) {
                  <select class="input !w-auto !py-1.5" [(ngModel)]="editNotifyMin">
                    @for (o of notifyOptions; track o.min) {
                      <option [ngValue]="o.min">{{ o.label }}</option>
                    }
                  </select>
                }
                <div class="flex-1"></div>
                <ui-button (click)="editLabelId = null">Cancel</ui-button>
                <ui-button variant="primary" [disabled]="!editName.trim()"
                           (click)="saveLabel(label)">Save</ui-button>
              </div>
            </div>
          } @else {
            <!-- 表示モード -->
            <div class="flex items-center gap-2.5 px-2.5 py-2 border-b border-cyber-line text-sm">
              <span class="w-2.5 h-2.5 shrink-0 shadow-[0_0_6px_currentColor]"
                    [style.background]="label.color" [style.color]="label.color"></span>
              <span class="flex-1 truncate">{{ label.name }}</span>
              <span class="text-xs text-cyber-dim whitespace-nowrap">
                {{ label.notify_default
                  ? '通知: ' + notifyMinLabel(label.notify_before_min_default)
                  : '通知なし' }}
              </span>
              <ui-button (click)="startEditLabel(label)">編集</ui-button>
              <button class="px-2 text-2xl leading-none text-cyber-dim hover:text-cyber-red"
                      title="削除" (click)="removeLabel(label)">×</button>
            </div>
          }
        } @empty {
          <div class="text-xs text-cyber-dim">
            プロジェクト (ラベル) はありません。カレンダー左のサイドバーから追加できます。
          </div>
        }
        <p class="text-xs text-cyber-dim mt-2">
          色とプロジェクト名はタイル表示に、通知設定はこのプロジェクトを選んで
          予定/タスクを新規作成するときの初期値に使われます。
        </p>
      </section>

      <!-- 4. 通知の送信先 (Webhook) -->
      <section>
        <div [class]="head">// Webhooks (Discord / Slack)</div>
        @for (hook of webhooks(); track hook.id) {
          <div class="flex items-center gap-2.5 px-2.5 py-2 border-b border-cyber-line text-sm">
            <mat-slide-toggle
              [checked]="hook.enabled"
              (change)="toggleWebhook(hook)"
              matTooltip="この送信先へ通知する/しない"
            />
            <span class="text-xs uppercase tracking-wider w-16 shrink-0"
                  [class.text-cyber-cyan]="hook.kind === 'discord'"
                  [class.text-cyber-green]="hook.kind === 'slack'"
            >{{ hook.kind }}</span>
            <div class="flex-1 min-w-0">
              <div class="truncate">{{ hook.name }}</div>
              <div class="text-xs text-cyber-dim truncate" [matTooltip]="hook.url">{{ hook.url }}</div>
            </div>
            <ui-button (click)="testWebhook(hook)">テスト</ui-button>
            <button class="px-2 text-2xl leading-none text-cyber-dim hover:text-cyber-red"
                    title="削除" (click)="removeWebhook(hook)">×</button>
          </div>
        } @empty {
          <div class="text-xs text-cyber-dim mb-2">通知の送信先は登録されていません</div>
        }
        <!-- 送信先の追加 -->
        <div class="flex gap-1.5 items-end mt-3 flex-wrap">
          <ui-form-field label="名前">
            <input type="text" class="input !py-1.5" placeholder="通知用チャンネル など"
                   [(ngModel)]="newHookName" />
          </ui-form-field>
          <ui-form-field label="種類">
            <select class="input !py-1.5" [(ngModel)]="newHookKind">
              <option value="discord">Discord</option>
              <option value="slack">Slack</option>
            </select>
          </ui-form-field>
          <ui-form-field label="Webhook URL">
            <input type="url" class="input !py-1.5" placeholder="https://discord.com/api/webhooks/…"
                   [(ngModel)]="newHookUrl" (keyup.enter)="addWebhook()" />
          </ui-form-field>
          <ui-button [disabled]="!newHookName.trim() || !newHookUrl.trim()" (click)="addWebhook()">
            追加
          </ui-button>
        </div>
      </section>

      <!-- 5. インポート / エクスポート -->
      <section>
        <div [class]="head">// Import / Export (iCalendar)</div>
        <div class="flex items-center gap-3 flex-wrap">
          <input #file type="file" accept=".ics,text/calendar" class="hidden"
                 (change)="onImport($event)" />
          <ui-button variant="primary" (click)="file.click()">.ics をインポート</ui-button>
          <a [href]="exportUrl" download>
            <ui-button variant="primary">.ics をエクスポート</ui-button>
          </a>
        </div>
        <p class="text-xs text-cyber-dim mt-2">
          Google カレンダー等からエクスポートした iCalendar 形式 (VEVENT / VTODO) に対応。
        </p>
      </section>

      <!-- 6. 外部カレンダー共有 -->
      <section>
        <div [class]="head">// External Calendars</div>
        @for (feed of store.feeds(); track feed.id) {
          <div class="flex items-center gap-2.5 px-2.5 py-2 border-b border-cyber-line text-sm">
            <mat-slide-toggle
              [checked]="feed.enabled"
              (change)="toggleFeed(feed)"
              matTooltip="カレンダーに表示する/しない"
            />
            <span class="w-2.5 h-2.5 shrink-0 shadow-[0_0_6px_currentColor]"
                  [style.background]="feed.color" [style.color]="feed.color"></span>
            <div class="flex-1 min-w-0">
              <div class="truncate">{{ feed.name }}</div>
              <!-- 購読 URL (ホバーで全文 / クリックでコピー) -->
              <div
                class="text-xs text-cyber-dim truncate cursor-pointer hover:text-cyber-cyan"
                [matTooltip]="feed.url + ' (クリックでコピー)'"
                (click)="copyUrl(feed)"
              >{{ feed.url }}</div>
              <!-- 同期エラーの表示 (原因をユーザーに見せる) -->
              @if (feed.last_error; as err) {
                <div class="text-xs text-cyber-red truncate" [matTooltip]="err">⚠ {{ err }}</div>
              }
            </div>
            <span class="text-xs text-cyber-dim whitespace-nowrap">
              {{ feed.last_synced_at ? fmtSynced(feed.last_synced_at) : '未同期' }}
            </span>
            <button class="px-2 text-xl leading-none text-cyber-dim hover:text-cyber-cyan"
                    title="今すぐ同期" (click)="syncFeed(feed)">↻</button>
            <button class="px-2 text-2xl leading-none text-cyber-dim hover:text-cyber-red"
                    title="購読解除" (click)="removeFeed(feed)">×</button>
          </div>
        } @empty {
          <div class="text-xs text-cyber-dim mb-2">購読中の外部カレンダーはありません</div>
        }
        <!-- 購読追加 -->
        <div class="flex flex-col gap-2 mt-3">
          <div class="flex gap-1.5 items-end">
            <ui-form-field label="名前">
              <input type="text" class="input !py-1.5" placeholder="仕事用 など"
                     [(ngModel)]="newName" />
            </ui-form-field>
            <input type="color" class="input !w-11 !h-9 !p-0.5 cursor-pointer shrink-0"
                   [(ngModel)]="newColor" />
          </div>
          <div class="flex gap-1.5 items-end">
            <ui-form-field label="ICS URL">
              <input type="url" class="input !py-1.5" placeholder="https://…/basic.ics"
                     [(ngModel)]="newUrl" (keyup.enter)="addFeed()" />
            </ui-form-field>
            <ui-button [disabled]="!newName.trim() || !newUrl.trim()" (click)="addFeed()">
              購読
            </ui-button>
          </div>
        </div>
        <p class="text-xs text-cyber-dim mt-2">
          公開 ICS の URL を登録すると 5 分ごとに自動同期され、カレンダーに重ねて表示されます。
          Google カレンダーは「設定 > 限定公開 URL (iCal 形式)」のアドレスを使用してください。
        </p>
      </section>
    </div>
  `,
})
export class SettingsPageComponent implements OnInit {
  store = inject(StoreService);
  settings = inject(SettingsService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private notification = inject(NotificationService);

  head = HEAD;
  exportUrl = ICS_EXPORT_URL;
  viewModes: { value: ViewMode; label: string }[] = [
    { value: 'day', label: '日' },
    { value: 'week', label: '週' },
    { value: 'month', label: '月' },
  ];
  themeModes: { value: ThemeMode; label: string }[] = [
    { value: 'light', label: 'ライト' },
    { value: 'dark', label: 'ダーク' },
    { value: 'system', label: 'システム' },
  ];
  darkThemes = DARK_THEMES;
  lightThemes = LIGHT_THEMES;
  notifyOptions = [
    { min: 0, label: '開始時刻ちょうど' },
    { min: 5, label: '5 分前' },
    { min: 10, label: '10 分前' },
    { min: 15, label: '15 分前' },
    { min: 30, label: '30 分前' },
    { min: 60, label: '1 時間前' },
    { min: 1440, label: '1 日前' },
  ];

  /** Webhook 一覧 (このページ内で完結する状態) */
  webhooks = signal<Webhook[]>([]);

  // 購読追加フォーム
  newName = '';
  newUrl = '';
  newColor = '#f5e642';

  // Webhook 追加フォーム
  newHookName = '';
  newHookKind: 'discord' | 'slack' = 'discord';
  newHookUrl = '';

  // ラベル編集フォーム (編集中のラベル id と入力値)
  editLabelId: number | null = null;
  editName = '';
  editColor = '#00f0ff';
  editNotify = false;
  editNotifyMin = 10;

  ngOnInit(): void {
    this.store.loadLabels();
    this.store.loadFeeds();
    this.loadWebhooks();
  }

  // ---- プロジェクト (ラベル) ----

  /** 通知タイミング (分) の表示名。選択肢にない値は「n 分前」で表示 */
  notifyMinLabel(min: number): string {
    return this.notifyOptions.find((o) => o.min === min)?.label ?? `${min} 分前`;
  }

  startEditLabel(label: Label): void {
    this.editLabelId = label.id;
    this.editName = label.name;
    this.editColor = label.color;
    this.editNotify = label.notify_default;
    this.editNotifyMin = label.notify_before_min_default;
  }

  saveLabel(label: Label): void {
    const name = this.editName.trim();
    if (!name) return;
    this.api
      .updateLabel(label.id, {
        name,
        color: this.editColor,
        notify_default: this.editNotify,
        notify_before_min_default: this.editNotifyMin,
      })
      .subscribe({
        next: (updated) => {
          this.editLabelId = null;
          this.store.loadLabels();
          this.store.reload(); // タイル色の変更をカレンダーへ反映
          this.toast.success(`「${updated.name}」を更新しました`);
        },
        error: (err) =>
          this.toast.error(
            err?.status === 409
              ? `「${name}」は既に存在します`
              : 'プロジェクトの更新に失敗しました',
          ),
      });
  }

  removeLabel(label: Label): void {
    if (!confirm(`「${label.name}」を削除しますか？ (予定/タスクは残ります)`)) return;
    this.api.deleteLabel(label.id).subscribe({
      next: () => {
        if (this.store.filterLabelId() === label.id) this.store.filterLabelId.set(null);
        this.store.loadLabels();
        this.store.reload();
        this.toast.success(`「${label.name}」を削除しました`);
      },
      error: () => this.toast.error('プロジェクトの削除に失敗しました'),
    });
  }

  // ---- 通知 ----

  permissionLabel(): string {
    if (!('Notification' in window)) return 'このブラウザは通知非対応です';
    return { granted: '許可済み', denied: '拒否されています (ブラウザ設定から変更)', default: '未設定' }[
      Notification.permission
    ];
  }

  async enableBrowserNotify(): Promise<void> {
    const ok = await this.notification.requestPermission();
    ok
      ? this.toast.success('ブラウザ通知を許可しました')
      : this.toast.error('通知が許可されませんでした');
  }

  // ---- Webhook ----

  private loadWebhooks(): void {
    this.api.getWebhooks().subscribe((hooks) => this.webhooks.set(hooks));
  }

  addWebhook(): void {
    const name = this.newHookName.trim();
    const url = this.newHookUrl.trim();
    if (!name || !url) return;
    this.api.createWebhook({ name, kind: this.newHookKind, url }).subscribe({
      next: (hook) => {
        this.newHookName = '';
        this.newHookUrl = '';
        this.loadWebhooks();
        this.toast.success(`「${hook.name}」を追加しました。テスト送信で確認できます`);
      },
      error: () => this.toast.error('追加に失敗しました (https:// の Webhook URL を確認してください)'),
    });
  }

  toggleWebhook(hook: Webhook): void {
    this.api.updateWebhook(hook.id, { enabled: !hook.enabled }).subscribe(() => {
      this.loadWebhooks();
      this.toast.info(`「${hook.name}」を${hook.enabled ? '無効' : '有効'}にしました`);
    });
  }

  testWebhook(hook: Webhook): void {
    this.api.testWebhook(hook.id).subscribe({
      next: () => this.toast.success(`「${hook.name}」へテスト通知を送信しました`),
      error: () => this.toast.error(`「${hook.name}」への送信に失敗しました。URL を確認してください`),
    });
  }

  removeWebhook(hook: Webhook): void {
    if (!confirm(`「${hook.name}」を削除しますか？`)) return;
    this.api.deleteWebhook(hook.id).subscribe(() => {
      this.loadWebhooks();
      this.toast.success(`「${hook.name}」を削除しました`);
    });
  }

  // ---- ICS インポート ----

  onImport(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.api.importIcs(file).subscribe({
      next: (r) => {
        this.toast.success(`予定 ${r.events} 件 / タスク ${r.tasks} 件を取り込みました`);
        this.store.reload();
      },
      error: () => this.toast.error('インポートに失敗しました (.ics 形式を確認してください)'),
    });
    input.value = ''; // 同じファイルの再選択でも change を発火させる
  }

  // ---- 外部カレンダー購読 ----

  addFeed(): void {
    const name = this.newName.trim();
    const url = this.newUrl.trim();
    if (!name || !url) return;
    this.api.createFeed({ name, url, color: this.newColor }).subscribe({
      next: (feed) => {
        this.newName = '';
        this.newUrl = '';
        this.store.loadFeeds();
        this.store.reload();
        // 初回同期の結果に応じてメッセージを変える
        if (feed.last_synced_at) {
          this.toast.success(`「${feed.name}」を購読しました`);
        } else if (feed.last_error) {
          this.toast.error(`「${feed.name}」を登録しましたが同期に失敗: ${feed.last_error}`);
        } else {
          this.toast.info(`「${feed.name}」を登録しました (同期は数分以内に行われます)`);
        }
      },
      error: () => this.toast.error('購読の登録に失敗しました (URL は http/https のみ対応)'),
    });
  }

  toggleFeed(feed: Feed): void {
    this.api.updateFeed(feed.id, { enabled: !feed.enabled }).subscribe(() => {
      this.store.loadFeeds();
      this.store.reload();
      this.toast.info(`「${feed.name}」を${feed.enabled ? '非表示' : '表示'}にしました`);
    });
  }

  syncFeed(feed: Feed): void {
    this.api.syncFeed(feed.id).subscribe({
      next: () => {
        this.store.loadFeeds();
        this.store.reload();
        this.toast.success(`「${feed.name}」を同期しました`);
      },
      error: (err) => {
        this.store.loadFeeds(); // last_error を画面に反映
        const detail = err?.error?.detail ?? 'URL を確認してください';
        this.toast.error(`「${feed.name}」の同期に失敗しました。${detail}`);
      },
    });
  }

  removeFeed(feed: Feed): void {
    if (!confirm(`「${feed.name}」の購読を解除しますか？`)) return;
    this.api.deleteFeed(feed.id).subscribe(() => {
      this.store.loadFeeds();
      this.store.reload();
      this.toast.success(`「${feed.name}」の購読を解除しました`);
    });
  }

  copyUrl(feed: Feed): void {
    navigator.clipboard
      .writeText(feed.url)
      .then(() => this.toast.info('URL をコピーしました'))
      .catch(() => this.toast.error('コピーに失敗しました'));
  }

  fmtSynced(iso: string): string {
    return fmtDateTime(new Date(iso));
  }
}
