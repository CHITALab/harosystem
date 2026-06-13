/**
 * トースト通知 — アプリ内のメッセージ表示はすべてここに集約する。
 * 実体は Angular Material の MatSnackBar。見た目は styles.scss の
 * .toast-success / .toast-error / .toast-info で定義している。
 *
 * 使い方:
 *   private toast = inject(ToastService);
 *   this.toast.success('保存しました');
 *   this.toast.error('保存に失敗しました');
 */
import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

type ToastType = 'success' | 'error' | 'info';

@Injectable({ providedIn: 'root' })
export class ToastService {
  private snack = inject(MatSnackBar);

  /** 操作の成功 (緑) */
  success(message: string): void {
    this.show(message, 'success', 3000);
  }

  /** エラー (赤)。読み落とさないよう少し長めに表示する */
  error(message: string): void {
    this.show(message, 'error', 6000);
  }

  /** 補足情報 (シアン) */
  info(message: string): void {
    this.show(message, 'info', 3000);
  }

  private show(message: string, type: ToastType, durationMs: number): void {
    this.snack.open(message, undefined, {
      duration: durationMs,
      panelClass: `toast-${type}`,
      horizontalPosition: 'center',
      verticalPosition: 'top',
    });
  }
}
