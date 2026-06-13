/**
 * @file label-api.service.ts
 * @description ラベル（Label）に関するAPI通信を担当するサービス。
 *
 * ラベルはイベントやタスクを分類するための機能です。
 * プロジェクト名や仕事／プライベートといったカテゴリに使用されます。
 *
 * ## 提供するメソッド
 * - `getLabels()` — 全ラベル一覧を取得
 * - `createLabel(data)` — 新しいラベルを作成
 * - `deleteLabel(id)` — ラベルを削除
 *
 * @example
 * ```ts
 * const labelApi = inject(LabelApiService);
 *
 * // ラベル一覧を取得
 * labelApi.getLabels().subscribe(labels => {
 *   console.log(labels);
 * });
 *
 * // 新規ラベル作成
 * labelApi.createLabel({ name: '仕事', color: '#4285f4' }).subscribe();
 * ```
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Label } from '../models';
import { BASE } from './api-base';

/**
 * ラベルAPIサービス。
 *
 * ラベルのCRUD操作（取得・作成・削除）を提供します。
 * `providedIn: 'root'` により、アプリケーション全体でシングルトンとして動作します。
 */
@Injectable({ providedIn: 'root' })
export class LabelApiService {
  /** HTTP通信クライアント */
  private http = inject(HttpClient);

  /**
   * 登録済みの全ラベルを取得します。
   *
   * @returns ラベルの配列を返すObservable
   */
  getLabels(): Observable<Label[]> {
    return this.http.get<Label[]>(`${BASE}/labels`);
  }

  /**
   * 新しいラベルを作成します。
   *
   * @param data - 作成するラベルの情報（name, color など）
   * @returns 作成されたラベルを返すObservable
   */
  createLabel(data: Partial<Label>): Observable<Label> {
    return this.http.post<Label>(`${BASE}/labels`, data);
  }

  /**
   * 指定したIDのラベルを更新します (名前・色・既定通知設定)。
   *
   * @param id - 更新するラベルのID
   * @param data - 更新内容 (PUT のため name / color は必須)
   * @returns 更新後のラベルを返すObservable
   */
  updateLabel(id: number, data: Partial<Label>): Observable<Label> {
    return this.http.put<Label>(`${BASE}/labels/${id}`, data);
  }

  /**
   * 指定したIDのラベルを削除します。
   *
   * ラベルに紐づくイベント・タスクのラベル参照は
   * バックエンド側で自動的に解除されます（NULL設定）。
   *
   * @param id - 削除するラベルのID
   * @returns 完了を通知するObservable
   */
  deleteLabel(id: number): Observable<void> {
    return this.http.delete<void>(`${BASE}/labels/${id}`);
  }
}
