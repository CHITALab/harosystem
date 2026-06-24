"""繰り返し展開 (recurrence.expand_occurrences) の回帰テスト。

主目的: 「毎週月曜」「平日」などの BYDAY を、クライアントのローカル TZ で正しく
評価できること (UTC 展開だと JST で 1 日ズレるバグの再発防止)。

pytest で実行: `pip install -r requirements-dev.txt && pytest`
単体実行も可: `python tests/test_recurrence.py`
"""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.recurrence import expand_occurrences

JST = ZoneInfo("Asia/Tokyo")
UTC = timezone.utc


def _jst_weekday(dt: datetime) -> int:
    """UTC aware datetime を JST の曜日 (月=0..日=6) に変換"""
    return dt.astimezone(JST).weekday()


def test_weekly_monday_lands_on_jst_monday_including_first():
    # JST 月曜 0:00 = UTC 日曜 15:00 (2026-06-15(月) JST の開始)
    anchor_start = datetime(2026, 6, 14, 15, 0, tzinfo=UTC)
    anchor_end = anchor_start + timedelta(hours=1)
    rng_start = datetime(2026, 6, 1, tzinfo=UTC)
    rng_end = datetime(2026, 7, 15, tzinfo=UTC)

    occ = expand_occurrences(
        "FREQ=WEEKLY;BYDAY=MO;COUNT=3", anchor_start, anchor_end, rng_start, rng_end, JST
    )
    # 3 回すべて JST 月曜
    assert [_jst_weekday(s) for s, _ in occ] == [0, 0, 0]
    # JST の日付が 6/15, 6/22, 6/29 (初回=開始日も含まれる)
    dates = [s.astimezone(JST).strftime("%Y-%m-%d") for s, _ in occ]
    assert dates == ["2026-06-15", "2026-06-22", "2026-06-29"]
    # 返り値は UTC で正規化されている
    assert all(s.tzinfo == UTC for s, _ in occ)


def test_weekday_preset_includes_monday_excludes_saturday():
    anchor_start = datetime(2026, 6, 14, 15, 0, tzinfo=UTC)  # JST 6/15(月) 0:00
    anchor_end = anchor_start + timedelta(minutes=30)
    rng_start = datetime(2026, 6, 14, tzinfo=UTC)
    rng_end = datetime(2026, 6, 21, tzinfo=UTC)

    occ = expand_occurrences(
        "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;COUNT=5",
        anchor_start, anchor_end, rng_start, rng_end, JST,
    )
    wds = sorted(_jst_weekday(s) for s, _ in occ)
    assert wds == [0, 1, 2, 3, 4]  # 月〜金。月(0)あり・土(5)なし


def test_utc_fallback_when_tz_none():
    # tz 未指定 (None) は UTC 展開 (後方互換)。dtstart が UTC 日曜なので BYDAY=MO は
    # UTC 月曜 = JST 火曜になる (=以前の挙動)。
    anchor_start = datetime(2026, 6, 14, 15, 0, tzinfo=UTC)
    anchor_end = anchor_start + timedelta(hours=1)
    occ = expand_occurrences(
        "FREQ=WEEKLY;BYDAY=MO;COUNT=1",
        anchor_start, anchor_end,
        datetime(2026, 6, 1, tzinfo=UTC), datetime(2026, 7, 1, tzinfo=UTC), None,
    )
    assert occ[0][0] == datetime(2026, 6, 15, 15, 0, tzinfo=UTC)  # UTC 月曜


def test_naive_inputs_are_normalized_to_utc_without_error():
    # naive datetime が混じっても例外にならず UTC として扱う (API が Z 無しで呼ばれた等)
    anchor_start = datetime(2026, 6, 15, 0, 0)  # naive
    anchor_end = datetime(2026, 6, 15, 1, 0)  # naive
    occ = expand_occurrences(
        "FREQ=DAILY;COUNT=2", anchor_start, anchor_end,
        datetime(2026, 6, 1), datetime(2026, 7, 1), None,  # range も naive
    )
    assert len(occ) == 2
    assert all(s.tzinfo == UTC for s, _ in occ)
    assert occ[0][0] == datetime(2026, 6, 15, 0, 0, tzinfo=UTC)


def test_invalid_rule_is_treated_as_single_occurrence():
    anchor_start = datetime(2026, 6, 14, 15, 0, tzinfo=UTC)
    anchor_end = anchor_start + timedelta(hours=1)
    occ = expand_occurrences(
        "not-a-rule", anchor_start, anchor_end,
        datetime(2026, 6, 1, tzinfo=UTC), datetime(2026, 7, 1, tzinfo=UTC), JST,
    )
    assert occ == [(anchor_start, anchor_end)]


if __name__ == "__main__":
    # pytest 無しでも実行できるよう、各テストを順に走らせる
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"  ok: {name}")
    print("ALL PASSED")
