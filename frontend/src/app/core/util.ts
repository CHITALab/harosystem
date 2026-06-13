/** 日付操作・整形のユーティリティ (外部ライブラリ不使用) */

export const pad = (n: number): string => String(n).padStart(2, '0');

/** その日の 00:00 を返す */
export const startOfDay = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** n 日後 (負数で過去) の Date を返す。元の Date は変更しない */
export const addDays = (d: Date, n: number): Date => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};

/** その週の日曜 00:00 を返す (週の起点は日曜) */
export const startOfWeek = (d: Date): Date => addDays(startOfDay(d), -d.getDay());

export const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** Date -> <input type="datetime-local"> 用の値 (ローカル時刻) */
export const toLocalInput = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const fmtTime = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const fmtDateTime = (d: Date): string =>
  `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${fmtTime(d)}`;

export const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * UTC の年月日をローカルタイムゾーンの 0:00 として読み替える。
 *
 * ICS の終日予定 (DATE 型) はサーバーで「UTC 0:00」として保存されるが、
 * 画面の日付判定はローカル時刻で行うため、そのまま比較すると
 * JST (UTC+9) では翌日にもはみ出して 1 日ズレて見える。
 * このため終日のフィード予定は UTC の年月日だけを取り出して
 * ローカル日付に変換してから扱う。
 */
export const utcDateToLocalIso = (iso: string): string => {
  const d = new Date(iso);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()).toISOString();
};

/** md チェックボックス 1 件分 (サイドバーのサブタスク表示に使う) */
export interface MdCheckbox {
  text: string;
  checked: boolean;
}

/**
 * markdown 中のタスクリスト記法 "[ ]"/"[x]" を出現順に列挙する。
 * 返り値の添字は toggleNthCheckbox の index と一致する。
 */
export const listCheckboxes = (src: string): MdCheckbox[] => {
  const re = /^\s*(?:[-*+]|\d+\.)\s+\[([ xX])\]\s*(.*)$/gm;
  const result: MdCheckbox[] = [];
  for (const m of src.matchAll(re)) {
    result.push({ text: m[2].trim(), checked: m[1] !== ' ' });
  }
  return result;
};

/**
 * markdown 中の index 番目 (0 始まり) のタスクリスト記法 "[ ]"/"[x]" を
 * 反転した文字列を返す。該当が無ければ null。
 * (詳細パネルのチェックボックスクリック処理から使う)
 */
export const toggleNthCheckbox = (src: string, index: number): string | null => {
  // 行頭 (+インデント) のリスト記号 (-, *, +, 1. 等) に続く [ ] / [x] / [X] にマッチ
  const re = /^(\s*(?:[-*+]|\d+\.)\s+)\[([ xX])\]/gm;
  let i = 0;
  let found = false;
  const result = src.replace(re, (whole, prefix: string, mark: string) => {
    if (i++ !== index) return whole;
    found = true;
    return `${prefix}[${mark === ' ' ? 'x' : ' '}]`;
  });
  return found ? result : null;
};
