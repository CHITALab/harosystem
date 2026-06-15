/**
 * 認証インターセプター — 全 HTTP リクエストに横断的に介入する。
 *
 * 2 つの責務:
 *   ① リクエスト: トークンがあれば Authorization: Bearer <token> を自動付与
 *   ② レスポンス: 401 が返ったら logout してログイン画面へリダイレクト
 *
 * Angular 17+ の関数型インターセプター (HttpInterceptorFn) で実装する。
 * DI は inject() 関数で行う (関数の実行コンテキストが Angular の注入文脈になる)。
 *
 * main.ts で provideHttpClient(withInterceptors([authInterceptor])) として登録する。
 */
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/** ログインエンドポイント。ここでの 401 は「資格情報の誤り」なので画面遷移しない */
const LOGIN_PATH = '/api/auth/login';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // ① トークンがあれば Authorization ヘッダーを付与する
  const token = auth.token();
  const authReq = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  // ② レスポンスの 401 を捕捉し、セッション切れとして扱う
  return next(authReq).pipe(
    catchError((err: HttpErrorResponse) => {
      // ログイン要求自体の 401 (パスワード誤り) は画面側で処理させる
      const isLoginRequest = req.url.includes(LOGIN_PATH);
      if (err.status === 401 && !isLoginRequest) {
        auth.logout();
        // 戻り先を保持してログイン画面へ
        router.navigate(['/login'], {
          queryParams: { redirect: router.url },
        });
      }
      // エラーはそのまま下流 (各操作の catchError) へ伝播させる
      return throwError(() => err);
    }),
  );
};
