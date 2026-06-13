/** SettingsService のユニットテスト — localStorage への永続化と既定値マージ */
import { TestBed } from '@angular/core/testing';
import { SettingsService } from './settings.service';

const KEY = 'neon-cal-settings';

describe('SettingsService', () => {
  beforeEach(() => localStorage.clear());

  const create = (): SettingsService => TestBed.inject(SettingsService);

  it('保存データが無ければ既定値で初期化される', () => {
    const s = create();
    expect(s.settings()).toEqual({
      userName: '',
      defaultView: 'week',
      autoRefreshSec: 60,
      notifyDefault: false,
      notifyBeforeMin: 10,
      themeMode: 'system',
      darkTheme: 'neon',
      lightTheme: 'paper',
    });
  });

  it('update で値が変わり localStorage に保存される', () => {
    const s = create();
    s.update({ userName: 'sora', defaultView: 'month' });
    expect(s.settings().userName).toBe('sora');
    expect(s.settings().defaultView).toBe('month');
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ userName: 'sora' });
  });

  it('保存済みデータから復元される', () => {
    localStorage.setItem(KEY, JSON.stringify({ userName: 'x', autoRefreshSec: 300 }));
    const s = create();
    expect(s.settings().userName).toBe('x');
    expect(s.settings().autoRefreshSec).toBe(300);
    // 保存されていない項目は既定値で補完される (後方互換)
    expect(s.settings().defaultView).toBe('week');
  });

  it('壊れた保存データは既定値にフォールバックする', () => {
    localStorage.setItem(KEY, '{invalid json');
    const s = create();
    expect(s.settings().defaultView).toBe('week');
  });
});
