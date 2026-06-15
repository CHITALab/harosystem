/**
 * 認証状態サービス — ログイン状態の「保持」と「永続化」を一手に担う。
 *
 * 役割の整理:
 *   - AuthApiService : HTTP の発行のみ (Observable を返す)
 *   - AuthService    : トークンの localStorage 保存/削除 + Signal で状態管理  ← このファイル
 *   - AuthInterceptor: 全リクエストへのヘッダー付与 + 401 ハンドリング
 *
 * 状態は BehaviorSubject ではなく Signal で持つ (プロジェクト方針)。
 * 非同期処理 (login/me) は AuthApiService の Observable を pipe で整形してから
 * Signal に反映する。
 *
 * 使い方:
 *   private auth = inject(AuthService);
 *   if (auth.isAuthenticated()) { ... }
 *   this.auth.token();          // インターセプターが参照する生トークン
 *   this.auth.logout();         // トークン破棄
 */
import { computed, Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { LoginResponse, User } from './models';
import { AuthApiService } from './api/auth-api.service';

/** localStorage に JWT を保存する際のキー */
const TOKEN_KEY = 'harosystem_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private authApi = inject(AuthApiService);

  /** 現在の JWT。未ログインなら null。インターセプターがヘッダー付与に参照する */
  readonly token = signal<string | null>(localStorage.getItem(TOKEN_KEY));

  /** 現在のユーザー情報。未取得 (未ログイン or 起動直後) なら null */
  readonly user = signal<User | null>(null);

  /** ログイン済みかどうか (トークンの有無で判定)。テンプレート/ガードで使う */
  readonly isAuthenticated = computed(() => this.token() !== null);

  /**
   * ユーザー名とパスワードでログインする。
   *
   * 成功時、トークンを localStorage と Signal に保存し、ユーザー情報を反映する。
   * エラー (401 等) は呼び出し側 (ログイン画面) で catchError してメッセージ表示する。
   *
   * @returns ログインレスポンスを流す Observable
   */
  login(username: string, password: string): Observable<LoginResponse> {
    return this.authApi.login({ username, password }).pipe(
      tap((res) => {
        this.setToken(res.access_token);
        this.user.set({ id: res.user_id, username: res.username });
      }),
    );
  }

  /**
   * ログアウトする。トークンとユーザー情報を破棄する。
   * 画面遷移 (ログイン画面へのリダイレクト) は呼び出し側 / インターセプターが担う。
   */
  logout(): void {
    this.user.set(null);
    this.setToken(null);
  }

  /**
   * 保存済みトークンを使ってユーザー情報を復元する (アプリ起動時に呼ぶ想定)。
   *
   * トークンが無効・期限切れなら 401 が返るので、呼び出し側で catchError して
   * logout() する。Authorization ヘッダーはインターセプターが付与する。
   *
   * @returns ユーザー情報を流す Observable
   */
  restoreSession(): Observable<User> {
    return this.authApi.me().pipe(tap((u) => this.user.set(u)));
  }

  /** トークンを Signal と localStorage の両方へ同期する (null なら削除) */
  private setToken(token: string | null): void {
    this.token.set(token);
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }
}
