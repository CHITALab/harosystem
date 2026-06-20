/**
 * 繰り返し (RRULE) のプリセット <-> RRULE 文字列 変換ヘルパー。
 *
 * バックエンドは RRULE 文字列を保存し dateutil で展開する。フロントはプリセット中心の
 * UI (毎日 / 平日 / 毎週(曜日) / 毎月 + 終了条件) で組み立て、既存ルールを UI 状態へ復元する。
 * 編集はマスター=全件に作用する簡易モデルのため、個別オカレンス例外 (EXDATE 等) は扱わない。
 */

/** JavaScript の getDay() (0=日) に対応する RRULE の曜日コード */
export const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
/** 曜日コードの日本語表示 */
export const WEEKDAY_LABELS: Record<string, string> = {
  SU: '日', MO: '月', TU: '火', WE: '水', TH: '木', FR: '金', SA: '土',
};
const WEEKDAYS_MO_FR = ['MO', 'TU', 'WE', 'TH', 'FR'];

export type RecurFreq = 'none' | 'daily' | 'weekday' | 'weekly' | 'monthly';
export type RecurEnd = 'never' | 'count' | 'until';

/** 繰り返し UI の状態 */
export interface RecurInput {
  freq: RecurFreq;
  /** 毎週のとき選択中の曜日コード (MO..SU) */
  days: string[];
  end: RecurEnd;
  count: number;
  /** 終了日 (YYYY-MM-DD, input[type=date] 用) */
  until: string;
}

/** UI 状態の既定値 (単発) */
export function emptyRecur(): RecurInput {
  return { freq: 'none', days: [], end: 'never', count: 10, until: '' };
}

/**
 * UI 状態から RRULE 文字列を組み立てる。単発 (none) なら null。
 * @param anchorWeekday マスター開始日の曜日 (毎週で曜日未選択のときの既定)
 */
export function buildRRule(input: RecurInput, anchorWeekday: number): string | null {
  let parts: string[];
  switch (input.freq) {
    case 'none':
      return null;
    case 'daily':
      parts = ['FREQ=DAILY'];
      break;
    case 'weekday':
      parts = ['FREQ=WEEKLY', `BYDAY=${WEEKDAYS_MO_FR.join(',')}`];
      break;
    case 'weekly': {
      const days = input.days.length ? input.days : [WEEKDAY_CODES[anchorWeekday]];
      // 曜日コードを一定順 (月→日) に並べる
      const ordered = WEEKDAYS_MO_FR.concat('SA', 'SU').filter((d) => days.includes(d));
      parts = ['FREQ=WEEKLY', `BYDAY=${ordered.join(',')}`];
      break;
    }
    case 'monthly':
      parts = ['FREQ=MONTHLY'];
      break;
  }
  if (input.end === 'count' && input.count > 0) {
    parts.push(`COUNT=${Math.floor(input.count)}`);
  } else if (input.end === 'until' && input.until) {
    // input[type=date] の "YYYY-MM-DD" をそのまま使う (Date 変換による TZ ずれを避ける)。
    // 終了日の 23:59:59 UTC まで。
    const ymd = input.until.replace(/-/g, '');
    parts.push(`UNTIL=${ymd}T235959Z`);
  }
  return parts.join(';');
}

/** RRULE 文字列を UI 状態へ復元する (編集時) */
export function parseRRule(rule: string | null): RecurInput {
  const out = emptyRecur();
  if (!rule) return out;
  const map = new Map<string, string>();
  for (const kv of rule.split(';')) {
    const [k, v] = kv.split('=');
    if (k && v) map.set(k.toUpperCase().trim(), v.trim());
  }
  const freq = map.get('FREQ');
  const byday = (map.get('BYDAY') ?? '').split(',').filter(Boolean);
  if (freq === 'DAILY') out.freq = 'daily';
  else if (freq === 'MONTHLY') out.freq = 'monthly';
  else if (freq === 'WEEKLY') {
    const isWeekday =
      byday.length === 5 && WEEKDAYS_MO_FR.every((d) => byday.includes(d));
    out.freq = isWeekday ? 'weekday' : 'weekly';
    out.days = byday;
  }
  if (map.has('COUNT')) {
    out.end = 'count';
    out.count = Number(map.get('COUNT')) || 10;
  } else if (map.has('UNTIL')) {
    out.end = 'until';
    const u = map.get('UNTIL')!; // YYYYMMDD... 形式
    out.until = `${u.slice(0, 4)}-${u.slice(4, 6)}-${u.slice(6, 8)}`;
  }
  return out;
}

/** RRULE 文字列を日本語の短い説明にする (詳細パネル表示用) */
export function humanizeRRule(rule: string | null): string {
  if (!rule) return '';
  const r = parseRRule(rule);
  let base: string;
  switch (r.freq) {
    case 'daily': base = '毎日'; break;
    case 'weekday': base = '平日'; break;
    case 'weekly':
      base = r.days.length
        ? `毎週 ${r.days.map((d) => WEEKDAY_LABELS[d] ?? d).join('・')}`
        : '毎週';
      break;
    case 'monthly': base = '毎月'; break;
    default: return '';
  }
  if (r.end === 'count') return `${base} (${r.count}回)`;
  if (r.end === 'until') return `${base} (${r.until}まで)`;
  return base;
}
