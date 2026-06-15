/**
 * @file index.ts
 * @description API層のバレル（barrel）ファイル。
 *
 * このファイルは分割された各APIサービスと定数を一箇所から
 * 再エクスポートします。外部からは以下のようにインポートできます：
 *
 * ```ts
 * import { LabelApiService, EventApiService, ICS_EXPORT_URL } from './api';
 * ```
 *
 * また、後方互換性を維持するために `ApiService` ファサードクラスも
 * 提供しています。既存コードで `ApiService` を使っている箇所は
 * 変更なしでそのまま動作します。
 *
 * ## アーキテクチャ方針
 * - 新規コードでは、用途に合った個別サービス（LabelApiService 等）を
 *   直接インジェクトすることを推奨します
 * - 既存コードは `ApiService` ファサード経由で引き続き動作します
 * - 状態は持ちません（状態管理は StoreService の Signals が担当）
 */
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { EventItem, Feed, FeedEvent, Label, TaskItem, Webhook } from '../models';

/* ── 個別サービスの再エクスポート ── */
export { LabelApiService } from './label-api.service';
export { EventApiService } from './event-api.service';
export { TaskApiService } from './task-api.service';
export { FeedApiService } from './feed-api.service';
export { WebhookApiService } from './webhook-api.service';
export { IcsApiService } from './ics-api.service';
export { AuthApiService } from './auth-api.service';
export { ICS_EXPORT_URL } from './api-base';

/* ── 個別サービスのインポート（ファサード内部で使用） ── */
import { LabelApiService } from './label-api.service';
import { EventApiService } from './event-api.service';
import { TaskApiService } from './task-api.service';
import { FeedApiService } from './feed-api.service';
import { WebhookApiService } from './webhook-api.service';
import { IcsApiService } from './ics-api.service';

/**
 * APIサービスファサード（後方互換性用）。
 *
 * 分割前の `ApiService` と同じインターフェースを提供し、
 * 内部では各個別サービスに委譲します。
 *
 * **新規コードでの使用は推奨しません。**
 * 代わりに `LabelApiService`、`EventApiService` など、
 * 機能ごとの個別サービスを直接インジェクトしてください。
 *
 * @deprecated 個別のAPIサービス（LabelApiService 等）を直接使用してください
 *
 * @example
 * ```ts
 * // 既存コード（引き続き動作します）
 * const api = inject(ApiService);
 * api.getLabels().subscribe();
 *
 * // 推奨される新しい書き方
 * const labelApi = inject(LabelApiService);
 * labelApi.getLabels().subscribe();
 * ```
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private labelApi = inject(LabelApiService);
  private eventApi = inject(EventApiService);
  private taskApi = inject(TaskApiService);
  private feedApi = inject(FeedApiService);
  private webhookApi = inject(WebhookApiService);
  private icsApi = inject(IcsApiService);

  // ---- ラベル ----

  /** @see LabelApiService.getLabels */
  getLabels(): Observable<Label[]> {
    return this.labelApi.getLabels();
  }

  /** @see LabelApiService.createLabel */
  createLabel(data: Partial<Label>): Observable<Label> {
    return this.labelApi.createLabel(data);
  }

  /** @see LabelApiService.updateLabel */
  updateLabel(id: number, data: Partial<Label>): Observable<Label> {
    return this.labelApi.updateLabel(id, data);
  }

  /** @see LabelApiService.deleteLabel */
  deleteLabel(id: number): Observable<void> {
    return this.labelApi.deleteLabel(id);
  }

  // ---- 予定 ----

  /** @see EventApiService.getEvents */
  getEvents(start: Date, end: Date, labelId: number | null): Observable<EventItem[]> {
    return this.eventApi.getEvents(start, end, labelId);
  }

  /** @see EventApiService.createEvent */
  createEvent(data: Partial<EventItem>): Observable<EventItem> {
    return this.eventApi.createEvent(data);
  }

  /** @see EventApiService.updateEvent */
  updateEvent(id: number, data: Partial<EventItem>): Observable<EventItem> {
    return this.eventApi.updateEvent(id, data);
  }

  /** @see EventApiService.deleteEvent */
  deleteEvent(id: number): Observable<void> {
    return this.eventApi.deleteEvent(id);
  }

  // ---- タスク ----

  /** @see TaskApiService.getTasks */
  getTasks(start: Date, end: Date, labelId: number | null): Observable<TaskItem[]> {
    return this.taskApi.getTasks(start, end, labelId);
  }

  /** @see TaskApiService.createTask */
  createTask(data: Partial<TaskItem>): Observable<TaskItem> {
    return this.taskApi.createTask(data);
  }

  /** @see TaskApiService.updateTask */
  updateTask(id: number, data: Partial<TaskItem>): Observable<TaskItem> {
    return this.taskApi.updateTask(id, data);
  }

  /** @see TaskApiService.deleteTask */
  deleteTask(id: number): Observable<void> {
    return this.taskApi.deleteTask(id);
  }

  // ---- ICS インポート ----

  /** @see IcsApiService.importIcs */
  importIcs(file: File): Observable<{ events: number; tasks: number }> {
    return this.icsApi.importIcs(file);
  }

  // ---- 外部カレンダー購読 (フィード) ----

  /** @see FeedApiService.getFeeds */
  getFeeds(): Observable<Feed[]> {
    return this.feedApi.getFeeds();
  }

  /** @see FeedApiService.createFeed */
  createFeed(data: Partial<Feed>): Observable<Feed> {
    return this.feedApi.createFeed(data);
  }

  /** @see FeedApiService.updateFeed */
  updateFeed(id: number, data: Partial<Feed>): Observable<Feed> {
    return this.feedApi.updateFeed(id, data);
  }

  /** @see FeedApiService.deleteFeed */
  deleteFeed(id: number): Observable<void> {
    return this.feedApi.deleteFeed(id);
  }

  /** @see FeedApiService.syncFeed */
  syncFeed(id: number): Observable<Feed> {
    return this.feedApi.syncFeed(id);
  }

  /** @see FeedApiService.getFeedEvents */
  getFeedEvents(start: Date, end: Date): Observable<FeedEvent[]> {
    return this.feedApi.getFeedEvents(start, end);
  }

  // ---- 通知の送信先 (Webhook) ----

  /** @see WebhookApiService.getWebhooks */
  getWebhooks(): Observable<Webhook[]> {
    return this.webhookApi.getWebhooks();
  }

  /** @see WebhookApiService.createWebhook */
  createWebhook(data: Partial<Webhook>): Observable<Webhook> {
    return this.webhookApi.createWebhook(data);
  }

  /** @see WebhookApiService.updateWebhook */
  updateWebhook(id: number, data: Partial<Webhook>): Observable<Webhook> {
    return this.webhookApi.updateWebhook(id, data);
  }

  /** @see WebhookApiService.deleteWebhook */
  deleteWebhook(id: number): Observable<void> {
    return this.webhookApi.deleteWebhook(id);
  }

  /** @see WebhookApiService.testWebhook */
  testWebhook(id: number): Observable<{ status: string }> {
    return this.webhookApi.testWebhook(id);
  }
}
