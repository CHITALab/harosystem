/**
 * ログイン画面。
 *
 * ユーザー名 + パスワードで認証し、成功したら元の画面 (redirect クエリ) または
 * カレンダー (/) へ遷移する。AppComponent のシェルは <router-outlet /> のみなので、
 * この画面はサイドバー等を持たない全画面表示になる。
 *
 * データフロー (CLAUDE.md の 3 層方針):
 *   AuthService.login() が Observable を返す
 *   → ここで pipe (tap/catchError) で整形
 *   → 状態 (loading/error) は Signal で保持
 *
 * UI はデザイン未定のため最小構成 (中央寄せカード)。装飾は控えめにする。
 */
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY, catchError, finalize, tap } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { UiButtonComponent } from '../../ui/button.component';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [FormsModule, UiButtonComponent],
  host: {
    class: 'min-h-screen flex items-center justify-center bg-cyber-bg p-4',
  },
  template: `
    <form
      class="w-full max-w-sm flex flex-col gap-4 border border-cyber-lineStrong
             bg-cyber-panel p-6"
      (ngSubmit)="submit()"
    >
      <!-- 見出し -->
      <h1 class="font-head text-lg tracking-[3px] uppercase text-cyber-cyan
                 drop-shadow-[0_0_8px_rgb(var(--c-cyan)/0.6)]">
        // Login
      </h1>

      <!-- ユーザー名 -->
      <label class="flex flex-col gap-1">
        <span class="text-xs text-cyber-dim tracking-wider uppercase">ユーザー名</span>
        <input
          type="text"
          name="username"
          class="input"
          autocomplete="username"
          [(ngModel)]="username"
          [disabled]="loading()"
          autofocus
        />
      </label>

      <!-- パスワード -->
      <label class="flex flex-col gap-1">
        <span class="text-xs text-cyber-dim tracking-wider uppercase">パスワード</span>
        <input
          type="password"
          name="password"
          class="input"
          autocomplete="current-password"
          [(ngModel)]="password"
          [disabled]="loading()"
        />
      </label>

      <!-- エラーメッセージ (赤テキスト) -->
      @if (error()) {
        <p class="text-sm text-cyber-red">{{ error() }}</p>
      }

      <!-- 送信 -->
      <ui-button
        variant="primary"
        size="lg"
        type="submit"
        [disabled]="loading() || !username.trim() || !password"
      >
        {{ loading() ? '認証中…' : 'ログイン' }}
      </ui-button>
    </form>
  `,
})
export class LoginPageComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  username = '';
  password = '';

  /** 送信中フラグ (二重送信防止 + ボタン文言切替) */
  readonly loading = signal(false);
  /** 認証失敗時のエラーメッセージ (null なら非表示) */
  readonly error = signal<string | null>(null);

  constructor() {
    // 既にログイン済みでこの画面に来た場合はカレンダーへ戻す
    if (this.auth.isAuthenticated()) {
      this.router.navigateByUrl('/');
    }
  }

  /** ログインを実行する */
  submit(): void {
    const username = this.username.trim();
    if (!username || !this.password || this.loading()) return;

    this.loading.set(true);
    this.error.set(null);

    this.auth.login(username, this.password).pipe(
      tap(() => {
        // redirect クエリがあればそこへ、なければカレンダー (/) へ
        const redirect = this.route.snapshot.queryParamMap.get('redirect');
        this.router.navigateByUrl(redirect || '/');
      }),
      catchError((err: HttpErrorResponse) => {
        this.error.set(this.messageFor(err));
        return EMPTY;
      }),
      finalize(() => this.loading.set(false)),
    ).subscribe();
  }

  /** HTTP ステータスからユーザー向けの日本語メッセージを決める */
  private messageFor(err: HttpErrorResponse): string {
    switch (err.status) {
      case 0:
        return 'サーバーに接続できません';
      case 401:
        return 'ユーザー名またはパスワードが正しくありません';
      default:
        return `ログインに失敗しました (${err.status})`;
    }
  }
}
