"""繰り返し予定 (RRULE) の展開ロジック。

マスター予定 1 件 + RRULE 文字列を保存し、一覧取得時に表示期間へ「仮想インスタンス」
として展開する (各回を DB に保存はしない)。編集・削除はマスターに作用する簡易モデル。

dateutil.rrule で展開する。range で区切るため無限ルールでも安全に終端する。
"""

from datetime import datetime, timedelta

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
) -> list[tuple[datetime, datetime]]:
    """マスターの (anchor_start, anchor_end) と RRULE から、表示期間 [range_start, range_end)
    に重なる各回の (start, end) を返す。

    - 各回の長さはマスターと同じ (anchor_end - anchor_start)。
    - 期間の開始境界をまたぐ長い予定も拾えるよう、下限を duration ぶん広げて探索する。
    - RRULE が解析不能なら単発予定として扱う (期間に重なる場合のみ返す)。
    """
    duration = anchor_end - anchor_start
    try:
        rule = rrulestr(rule_str, dtstart=anchor_start)
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
            out.append((occ_start, occ_end))
            if len(out) >= MAX_OCCURRENCES:
                break
    return out
