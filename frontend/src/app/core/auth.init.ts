/**
 * 起動時セッション復元 — APP_INITIALIZER 用の Provider。
 *
 * アプリのブートストラップ完了前にトークンを検証することで、
 * 「一瞬カレンダーが見えてからログイン画面に飛ばされる」ちらつきを防ぐ。
 *
 * 挙動:
 *   - トークンが無い           → 即 resolve (ログイン画面はガードが担う)
 *   - トークンが有効 (200)      → user Signal が埋まり、そのまま続行
 *   - トークンが無効/失効 (401) → logout してから resolve (= 未ログイン状態で起動)
 *
 * 重要: ここでは決して reject しない。ネットワーク不調でもアプリ自体は
 * 起動させ、その後の API 呼び出しの 401 ハンドリングに委ねる。
 *
 * main.ts の providers に provideAuthInitializer() を追加して使う。
 */
import { APP_INITIALIZER, Provider } from '@angular/core';
import { catchError, firstValueFrom, of } from 'rxjs';
import { AuthService } from './auth.service';

/** APP_INITIALIZER に登録する Provider を返す */
export function provideAuthInitializer(): Provider {
  return {
    provide: APP_INITIALIZER,
    multi: true,
    useFactory: (auth: AuthService) => () => {
      // トークンが無ければ検証不要。即座に完了する
      if (!auth.token()) {
        return Promise.resolve();
      }
      // トークン検証。失敗 (401 等) は logout して握りつぶし、起動は止めない
      return firstValueFrom(
        auth.restoreSession().pipe(
          catchError(() => {
            auth.logout();
            return of(null);
          }),
        ),
      );
    },
    deps: [AuthService],
  };
}
