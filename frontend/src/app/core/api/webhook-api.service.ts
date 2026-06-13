/**
 * @file webhook-api.service.ts
 * @description 通知送信先（Webhook）に関するAPI通信を担当するサービス。
 *
 * WebhookはDiscordやSlackのIncoming Webhookを登録して、
 * イベントやタスクの通知を外部サービスに送信する機能です。
 *
 * ## 提供するメソッド
 * - `getWebhooks()` — 登録済みWebhook一覧を取得
 * - `createWebhook(data)` — 新しいWebhookを登録
 * - `updateWebhook(id, data)` — Webhookの設定を更新
 * - `deleteWebhook(id)` — Webhookを削除
 * - `testWebhook(id)` — テスト通知を送信して設定を確認
 *
 * @example
 * ```ts
 * const webhookApi = inject(WebhookApiService);
 *
 * // Discord Webhookを登録
 * webhookApi.createWebhook({
 *   name: 'Discord通知',
 *   kind: 'discord',
 *   url: 'https://discord.com/api/webhooks/...',
 *   enabled: true,
 * }).subscribe();
 *
 * // テスト通知を送信
 * webhookApi.testWebhook(1).subscribe(result => {
 *   console.log(result.status); // 'ok' など
 * });
 * ```
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Webhook } from '../models';
import { BASE } from './api-base';

/**
 * WebhookAPIサービス。
 *
 * 通知送信先（Discord / Slack Webhook）のCRUD操作とテスト送信機能を提供します。
 * `providedIn: 'root'` により、アプリケーション全体でシングルトンとして動作します。
 */
@Injectable({ providedIn: 'root' })
export class WebhookApiService {
  /** HTTP通信クライアント */
  private http = inject(HttpClient);

  /**
   * 登録済みの全Webhookを取得します。
   *
   * @returns Webhookの配列を返すObservable
   */
  getWebhooks(): Observable<Webhook[]> {
    return this.http.get<Webhook[]>(`${BASE}/webhooks`);
  }

  /**
   * 新しいWebhookを登録します。
   *
   * @param data - 登録するWebhookの情報（name, kind, url など）
   * @returns 作成されたWebhookを返すObservable
   */
  createWebhook(data: Partial<Webhook>): Observable<Webhook> {
    return this.http.post<Webhook>(`${BASE}/webhooks`, data);
  }

  /**
   * 既存のWebhookの設定を更新します。
   *
   * 有効/無効の切り替え、名前やURLの変更などに使用します。
   *
   * @param id - 更新するWebhookのID
   * @param data - 更新するフィールドのみを含むオブジェクト
   * @returns 更新後のWebhookを返すObservable
   */
  updateWebhook(id: number, data: Partial<Webhook>): Observable<Webhook> {
    return this.http.put<Webhook>(`${BASE}/webhooks/${id}`, data);
  }

  /**
   * 指定したIDのWebhookを削除します。
   *
   * @param id - 削除するWebhookのID
   * @returns 完了を通知するObservable
   */
  deleteWebhook(id: number): Observable<void> {
    return this.http.delete<void>(`${BASE}/webhooks/${id}`);
  }

  /**
   * テスト通知を送信して、Webhookの設定が正しいか確認します。
   *
   * 登録したURLに対してテスト用のペイロードを送信し、
   * 送信結果のステータスを返します。
   *
   * @param id - テストするWebhookのID
   * @returns ステータス情報を返すObservable
   */
  testWebhook(id: number): Observable<{ status: string }> {
    return this.http.post<{ status: string }>(`${BASE}/webhooks/${id}/test`, {});
  }
}
