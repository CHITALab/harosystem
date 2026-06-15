/**
 * 認証ガード — 保護されたルートへのアクセスを認証状態で制御する。
 *
 * Angular 17+ の関数型ガード (CanActivateFn) で実装する。
 * 未認証なら /login へリダイレクト (UrlTree を返す) し、元の遷移先を
 * redirect クエリに退避する。ログイン後に戻れるようにするため。
 *
 * 判定は AuthService の Signal (isAuthenticated) を同期的に読むだけ。
 * トークンの実検証は起動時の APP_INITIALIZER (restoreSession) で済んでいる前提。
 *
 * app.routes.ts で { canActivate: [authGuard] } として適用する。
 */
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) {
    return true;
  }

  // 未認証: ログイン画面へ。戻り先 (アクセスしようとした URL) を退避する
  return router.createUrlTree(['/login'], {
    queryParams: { redirect: state.url },
  });
};
