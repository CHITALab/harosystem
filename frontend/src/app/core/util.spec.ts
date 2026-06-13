/** util.ts のユニットテスト — 日付操作と md チェックボックストグル */
import {
  addDays,
  listCheckboxes,
  fmtDateTime,
  fmtTime,
  pad,
  sameDay,
  startOfDay,
  startOfWeek,
  toggleNthCheckbox,
  toLocalInput,
  utcDateToLocalIso,
} from './util';

describe('日付ユーティリティ', () => {
  it('pad: 1桁を0埋めする', () => {
    expect(pad(5)).toBe('05');
    expect(pad(12)).toBe('12');
  });

  it('startOfDay: その日の 00:00 を返す', () => {
    const d = startOfDay(new Date(2026, 5, 11, 15, 30));
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getDate()).toBe(11);
  });

  it('addDays: 日を加算し、元の Date は変更しない', () => {
    const base = new Date(2026, 5, 30); // 6/30
    const next = addDays(base, 1);
    expect(next.getMonth()).toBe(6); // 7月へ繰り上がる
    expect(next.getDate()).toBe(1);
    expect(base.getDate()).toBe(30); // 不変
  });

  it('addDays: 負数で過去へ', () => {
    const prev = addDays(new Date(2026, 0, 1), -1);
    expect(prev.getFullYear()).toBe(2025);
    expect(prev.getMonth()).toBe(11);
    expect(prev.getDate()).toBe(31);
  });

  it('startOfWeek: 直前の日曜 00:00 を返す', () => {
    // 2026-06-11 は木曜 → 週の起点は 6/7 (日)
    const d = startOfWeek(new Date(2026, 5, 11, 10, 0));
    expect(d.getDay()).toBe(0);
    expect(d.getDate()).toBe(7);
    expect(d.getHours()).toBe(0);
  });

  it('startOfWeek: 日曜ならその日を返す', () => {
    const d = startOfWeek(new Date(2026, 5, 7, 23, 59));
    expect(d.getDate()).toBe(7);
  });

  it('sameDay: 時刻が違っても同じ日なら true', () => {
    expect(sameDay(new Date(2026, 5, 11, 0, 1), new Date(2026, 5, 11, 23, 59))).toBe(true);
    expect(sameDay(new Date(2026, 5, 11), new Date(2026, 5, 12))).toBe(false);
  });

  it('toLocalInput: datetime-local 形式 (ローカル時刻)', () => {
    expect(toLocalInput(new Date(2026, 5, 1, 9, 5))).toBe('2026-06-01T09:05');
  });

  it('fmtTime / fmtDateTime', () => {
    const d = new Date(2026, 5, 11, 8, 3);
    expect(fmtTime(d)).toBe('08:03');
    expect(fmtDateTime(d)).toBe('2026/06/11 08:03');
  });

  it('utcDateToLocalIso: UTC の年月日をローカル 0:00 に読み替える', () => {
    // ICS 終日予定の保存形式 (UTC 0:00) → ローカルの同じ年月日 0:00 になる
    const local = new Date(utcDateToLocalIso('2026-06-12T00:00:00Z'));
    expect(local.getFullYear()).toBe(2026);
    expect(local.getMonth()).toBe(5);
    expect(local.getDate()).toBe(12);
    expect(local.getHours()).toBe(0);
    expect(local.getMinutes()).toBe(0);
  });
});

describe('listCheckboxes (md チェックボックス列挙)', () => {
  const md = ['# Todo', '- [ ] 買い物', '- [x] 掃除', '  - [ ] ネスト', '1. [X] 番号付き'].join(
    '\n',
  );

  it('出現順に text と checked を返す', () => {
    expect(listCheckboxes(md)).toEqual([
      { text: '買い物', checked: false },
      { text: '掃除', checked: true },
      { text: 'ネスト', checked: false },
      { text: '番号付き', checked: true },
    ]);
  });

  it('添字が toggleNthCheckbox の index と一致する', () => {
    // 2 番目 (ネスト) を反転 → listCheckboxes でも 2 番目が checked になる
    const toggled = toggleNthCheckbox(md, 2)!;
    expect(listCheckboxes(toggled)[2]).toEqual({ text: 'ネスト', checked: true });
  });

  it('チェックボックスが無い文章は空配列', () => {
    expect(listCheckboxes('ただの文章 [ ] 行頭でない')).toEqual([]);
  });
});

describe('toggleNthCheckbox (md チェックボックス反転)', () => {
  const md = ['# Todo', '- [ ] 買い物', '- [x] 掃除', '  - [ ] ネスト', '1. [X] 番号付き'].join(
    '\n',
  );

  it('0番目: 未チェック → チェック', () => {
    expect(toggleNthCheckbox(md, 0)).toContain('- [x] 買い物');
  });

  it('1番目: チェック → 未チェック', () => {
    expect(toggleNthCheckbox(md, 1)).toContain('- [ ] 掃除');
  });

  it('インデント付きのネストも対象になる', () => {
    expect(toggleNthCheckbox(md, 2)).toContain('  - [x] ネスト');
  });

  it('番号付きリストの [X] も外せる', () => {
    expect(toggleNthCheckbox(md, 3)).toContain('1. [ ] 番号付き');
  });

  it('対象以外の行は変更しない', () => {
    const result = toggleNthCheckbox(md, 0)!;
    expect(result).toContain('# Todo');
    expect(result).toContain('- [x] 掃除'); // 1番目はそのまま
  });

  it('範囲外の index は null', () => {
    expect(toggleNthCheckbox(md, 99)).toBeNull();
  });

  it('チェックボックスが無い文章は null', () => {
    expect(toggleNthCheckbox('ただの文章 [ ] 行頭でない', 0)).toBeNull();
  });
});
