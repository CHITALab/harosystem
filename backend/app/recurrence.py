"""繰り返し予定 (RRULE) の展開ロジック。

マスター予定 1 件 + RRULE 文字列を保存し、一覧取得時に表示期間へ「仮想インスタンス」
として展開する (各回を DB に保存はしない)。編集・削除はマスターに作用する簡易モデル。

dateutil.rrule で展開する。range で区切るため無限ルールでも安全に終端する。
"""

from datetime import datetime, timedelta, timezone, tzinfo

from dateutil.rrule import rrulestr

# 1 回の展開で返す回数の上限 (出力の暴走防止)
MAX_OCCURRENCES = 366
# 1 回の展開で回す総ステップ上限 (dtstart が極端に過去でも前進コストを有界化し DoS を防ぐ)。
# DAILY でも約 137 年ぶんの前進を許容するので実在の予定には十分。極端に過去の
# 開始日 (悪意ある入力等) はこの上限で打ち切られ、最悪計算量が抑えられる。
MAX_ITERATIONS = 50_000


def expand_occurrences(
    rule_str: str,
    anchor_start: datetime,
    anchor_end: datetime,
    range_start: datetime,
    range_end: datetime,
    tz: tzinfo | None = None,
) -> list[tuple[datetime, datetime]]:
    """マスターの (anchor_start, anchor_end) と RRULE から、表示期間 [range_start, range_end)
    に重なる各回の (start, end) を **UTC** で返す。

    - 各回の長さはマスターと同じ (anchor_end - anchor_start)。
    - 期間の開始境界をまたぐ長い予定も拾えるよう、下限を duration ぶん広げて探索する。
    - RRULE が解析不能なら単発予定として扱う (期間に重なる場合のみ返す)。
    - tz: 曜日 (BYDAY) を解釈するタイムゾーン。「毎週月曜」の“月曜”はローカルの曜日なので、
      dtstart をこの tz に変換してから展開する (例: JST)。時刻の保存・返却は一貫して UTC。
      tz=None なら UTC で展開する (後方互換)。
    """
    # 入力に naive datetime が混じると astimezone / aware比較で例外になるため UTC を補う
    # (例: API を ?start=... の Z 無しで呼ばれた場合など)。保存は本来 TIMESTAMPTZ で aware。
    def _aware(dt: datetime) -> datetime:
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt

    anchor_start = _aware(anchor_start)
    anchor_end = _aware(anchor_end)
    range_start = _aware(range_start)
    range_end = _aware(range_end)

    duration = anchor_end - anchor_start
    # BYDAY 等をローカル曜日で正しく評価するため dtstart を tz に合わせる
    dtstart = anchor_start.astimezone(tz) if tz is not None else anchor_start
    try:
        rule = rrulestr(rule_str, dtstart=dtstart)
    except (ValueError, TypeError):
        if anchor_end > range_start and anchor_start < range_end:
            return [(anchor_start, anchor_end)]
        return []

    # ルールを遅延イテレートし、(a) 出力回数 MAX_OCCURRENCES と (b) 総ステップ数
    # MAX_ITERATIONS の両方で打ち切る。between/xafter と違い、dtstart が極端に過去でも
    # 前進 (range_start までの読み飛ばし) を含めて総コストが有界になる。
    after = range_start - duration
    out: list[tuple[datetime, datetime]] = []
    steps = 0
    for occ_start in rule:
        steps += 1
        if steps > MAX_ITERATIONS or occ_start >= range_end:
            break
        if occ_start < after:
            continue  # 表示期間より前は読み飛ばす (前進)
        occ_end = occ_start + duration
        if occ_end > range_start and occ_start < range_end:
            # 保存/転送は UTC に統一して返す (展開だけ tz で曜日解釈)
            out.append((occ_start.astimezone(timezone.utc), occ_end.astimezone(timezone.utc)))
            if len(out) >= MAX_OCCURRENCES:
                break
    return out
