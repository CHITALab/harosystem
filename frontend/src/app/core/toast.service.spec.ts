/**
 * ToastService のテスト — MatSnackBar をモックして
 * 種類ごとの panelClass / 表示時間が正しいことを確認する。
 */
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  let service: ToastService;
  let snack: { open: jest.Mock };

  beforeEach(() => {
    snack = { open: jest.fn() };
    TestBed.configureTestingModule({
      providers: [{ provide: MatSnackBar, useValue: snack }],
    });
    service = TestBed.inject(ToastService);
  });

  it('success: 緑のトーストを 3 秒表示する', () => {
    service.success('保存しました');
    expect(snack.open).toHaveBeenCalledWith(
      '保存しました',
      undefined,
      expect.objectContaining({ duration: 3000, panelClass: 'toast-success' }),
    );
  });

  it('error: 赤のトーストを長め (6 秒) に表示する', () => {
    service.error('失敗しました');
    expect(snack.open).toHaveBeenCalledWith(
      '失敗しました',
      undefined,
      expect.objectContaining({ duration: 6000, panelClass: 'toast-error' }),
    );
  });

  it('info: シアンのトーストを 3 秒表示する', () => {
    service.info('補足です');
    expect(snack.open).toHaveBeenCalledWith(
      '補足です',
      undefined,
      expect.objectContaining({ duration: 3000, panelClass: 'toast-info' }),
    );
  });

  it('表示位置は画面上部中央', () => {
    service.info('x');
    expect(snack.open).toHaveBeenCalledWith(
      'x',
      undefined,
      expect.objectContaining({ horizontalPosition: 'center', verticalPosition: 'top' }),
    );
  });
});
