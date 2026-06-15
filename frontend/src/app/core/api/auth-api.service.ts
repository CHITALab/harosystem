/**
 * @file auth-api.service.ts
 * @description 認証 (ログイン / トークン検証) に関する API 通信を担当するサービス。
 *
 * このサービスは「HTTP リクエストの発行」だけを責務とし、Observable を
 * そのまま返します。トークンの保存やログイン状態の管理は行いません
 * （それらは AuthService の責務）。3 層データフロー
 * （HttpClient → RxJS → Signal）の最下層にあたります。
 *
 * ## 提供するメソッド
 * - `login(body)` — ユーザー名 + パスワードで認証し、JWT を取得
 * - `me()`        — 現在のトークンを検証し、ユーザー情報を取得
 *
 * @example
 * ```ts
 * const authApi = inject(AuthApiService);
 *
 * // ログイン → RxJS で整形して呼び出し側で状態に反映
 * authApi.login({ username: 'admin', password: 'secret' }).subscribe(res => {
 *   console.log(res.access_token);
 * });
 * ```
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { LoginRequest, LoginResponse, User } from '../models';
import { BASE } from './api-base';

/**
 * 認証 API サービス。
 *
 * `providedIn: 'root'` によりアプリ全体でシングルトンとして動作します。
 * 状態は持たず、HTTP の Observable を返すだけに徹します。
 */
@Injectable({ providedIn: 'root' })
export class AuthApiService {
  /** HTTP 通信クライアント */
  private http = inject(HttpClient);

  /**
   * ユーザー名とパスワードで認証し、JWT アクセストークンを取得します。
   *
   * 認証に失敗した場合、バックエンドは 401 を返します
   * （呼び出し側で catchError によりハンドリングしてください）。
   *
   * @param body - ユーザー名とパスワード
   * @returns アクセストークンとユーザー情報を返す Observable
   */
  login(body: LoginRequest): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${BASE}/auth/login`, body);
  }

  /**
   * 現在のトークンが有効かを検証し、ユーザー情報を取得します。
   *
   * Authorization ヘッダーは AuthInterceptor が自動付与します。
   * トークンが無効・期限切れの場合は 401 が返ります。
   *
   * @returns 認証済みユーザー情報を返す Observable
   */
  me(): Observable<User> {
    return this.http.get<User>(`${BASE}/auth/me`);
  }
}
