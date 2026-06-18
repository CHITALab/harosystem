/**
 * @file note-api.service.ts
 * @description プロジェクト（Label）に紐づく Markdown ノートの API 通信を担当するサービス。
 *
 * ノートは「1回で終わらないタスクや調査メモを横断的に1箇所へまとめる」ための機能です。
 * Label (1) 対 Note (多) / Note (1) 対 Task (多) の関係を持ちます。
 * タスクとの紐付けは Task 側の note_id で表現するため、紐付け/解除は
 * TaskApiService.updateTask({ note_id }) で行います。
 *
 * ## 提供するメソッド
 * - `getNotes(labelId?)` — ノート一覧を取得（ラベルで絞り込み可能）
 * - `getNote(id)` — ノート 1 件を取得
 * - `createNote(data)` — 新しいノートを作成
 * - `updateNote(id, data)` — ノートを部分更新
 * - `deleteNote(id)` — ノートを削除（紐付くタスクは残り note_id だけ外れる）
 *
 * @example
 * ```ts
 * const noteApi = inject(NoteApiService);
 * noteApi.getNotes().subscribe(notes => console.log(notes));
 * ```
 */
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Note } from '../models';
import { BASE } from './api-base';

/**
 * ノート API サービス。
 *
 * ノートの CRUD 操作を提供します。状態は持たず Observable を返すだけに徹し、
 * 状態管理は呼び出し側（StoreService の Signal）が担います。
 */
@Injectable({ providedIn: 'root' })
export class NoteApiService {
  /** HTTP通信クライアント */
  private http = inject(HttpClient);

  /**
   * ノート一覧を取得します（更新日時の降順）。
   *
   * @param labelId - 絞り込むラベルID（null/未指定なら全ラベル対象）
   * @returns ノートの配列を返すObservable
   */
  getNotes(labelId?: number | null): Observable<Note[]> {
    let params = new HttpParams();
    if (labelId != null) params = params.set('label_id', labelId);
    return this.http.get<Note[]>(`${BASE}/notes`, { params });
  }

  /**
   * 指定IDのノートを 1 件取得します。
   *
   * @param id - ノートID
   * @returns ノートを返すObservable
   */
  getNote(id: number): Observable<Note> {
    return this.http.get<Note>(`${BASE}/notes/${id}`);
  }

  /**
   * 新しいノートを作成します。
   *
   * @param data - 作成するノートの情報
   * @returns 作成されたノートを返すObservable
   */
  createNote(data: Partial<Note>): Observable<Note> {
    return this.http.post<Note>(`${BASE}/notes`, data);
  }

  /**
   * 既存のノートを部分更新します。
   *
   * @param id - 更新するノートのID
   * @param data - 更新するフィールドのみを含むオブジェクト
   * @returns 更新後のノートを返すObservable
   */
  updateNote(id: number, data: Partial<Note>): Observable<Note> {
    return this.http.put<Note>(`${BASE}/notes/${id}`, data);
  }

  /**
   * 指定したIDのノートを削除します。
   *
   * @param id - 削除するノートのID
   * @returns 完了を通知するObservable
   */
  deleteNote(id: number): Observable<void> {
    return this.http.delete<void>(`${BASE}/notes/${id}`);
  }
}
