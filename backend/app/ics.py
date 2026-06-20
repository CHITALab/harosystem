"""iCalendar (.ics) の生成・解析。

DB に依存しない純粋関数のみを置く (テストしやすさのため)。
  - build_ics  : 予定/タスク -> .ics バイト列 (エクスポート)
  - parse_ics  : .ics バイト列 -> 予定/タスクの dict リスト (インポート/フィード同期)

ICS の主な対応マッピング:
  VEVENT  <-> Event (SUMMARY=title, DESCRIPTION=content, DTSTART/DTEND)
  VTODO   <-> Task  (DTSTART=start_at, DUE=end_at, STATUS:COMPLETED=done)
  日付のみの DTSTART (DATE 型) は終日予定として扱う。
"""

from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from icalendar import Calendar, Event as IcsEvent, Todo as IcsTodo
from icalendar.prop import vRecur

PRODID = "-//harosystem//harosystem//JA"


def _to_utc(value: Any) -> datetime:
    """icalendar の戻り値 (date / naive datetime / aware datetime) を UTC へ正規化"""
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, date):
        # 日付のみ (終日) は 00:00 UTC とみなす
        return datetime.combine(value, time.min, tzinfo=timezone.utc)
    raise ValueError(f"unsupported ICS date value: {value!r}")


# ---------------- エクスポート ----------------


def build_ics(events: list, tasks: list) -> bytes:
    """Event / Task の ORM (または同名属性を持つオブジェクト) から .ics を生成する"""
    cal = Calendar()
    cal.add("prodid", PRODID)
    cal.add("version", "2.0")

    for ev in events:
        ve = IcsEvent()
        ve.add("uid", f"event-{ev.id}@harosystem")
        ve.add("summary", ev.title)
        if ev.content:
            ve.add("description", ev.content)
        if ev.all_day:
            # 終日は DATE 型 (時刻なし) で出力するのが慣例
            ve.add("dtstart", ev.start_at.date())
            ve.add("dtend", ev.end_at.date())
        else:
            ve.add("dtstart", ev.start_at)
            ve.add("dtend", ev.end_at)
        # 繰り返し予定は RRULE を付与する (マスターのみ。各回は展開しない)
        if getattr(ev, "recurrence", None):
            try:
                ve.add("rrule", vRecur.from_ical(ev.recurrence))
            except (ValueError, TypeError):
                pass
        cal.add_component(ve)

    for task in tasks:
        vt = IcsTodo()
        vt.add("uid", f"task-{task.id}@harosystem")
        vt.add("summary", task.title)
        if task.content:
            vt.add("description", task.content)
        # 開始/終了時刻 → DTSTART / DUE (未スケジュールなら出力しない)
        if task.start_at:
            vt.add("dtstart", task.start_at)
        if task.end_at:
            vt.add("due", task.end_at)
        vt.add("status", "COMPLETED" if task.done else "NEEDS-ACTION")
        cal.add_component(vt)

    return cal.to_ical()


# ---------------- インポート / フィード解析 ----------------


def parse_ics(data: bytes) -> tuple[list[dict], list[dict]]:
    """.ics を解析して (予定 dict のリスト, タスク dict のリスト) を返す。

    戻り値の dict キーは Event / Task モデルのカラム名と一致させている
    (そのまま models.Event(**d) で生成できる)。
    解析できないコンポーネントは黙ってスキップする。
    """
    cal = Calendar.from_ical(data)
    events: list[dict] = []
    tasks: list[dict] = []

    for comp in cal.walk():
        try:
            if comp.name == "VEVENT":
                parsed = _parse_vevent(comp)
                if parsed:
                    events.append(parsed)
            elif comp.name == "VTODO":
                parsed = _parse_vtodo(comp)
                if parsed:
                    tasks.append(parsed)
        except (ValueError, KeyError, AttributeError):
            continue  # 1 コンポーネントの不備で全体を失敗させない

    return events, tasks


def _parse_vevent(comp) -> dict | None:
    dtstart = comp.get("dtstart")
    if dtstart is None:
        return None
    all_day = not isinstance(dtstart.dt, datetime)  # DATE 型なら終日
    start = _to_utc(dtstart.dt)

    dtend = comp.get("dtend")
    if dtend is not None:
        end = _to_utc(dtend.dt)
    elif comp.get("duration") is not None:
        end = start + comp.get("duration").dt
    else:
        # 終了情報なし: 終日は翌日まで、それ以外は 1 時間
        end = start + (timedelta(days=1) if all_day else timedelta(hours=1))

    # 繰り返し: RRULE を文字列化して取り込む (例 "FREQ=WEEKLY;BYDAY=MO")
    rrule = comp.get("rrule")
    recurrence = rrule.to_ical().decode() if rrule is not None else None

    return {
        "uid": str(comp.get("uid", "")),
        "title": str(comp.get("summary", "(no title)")),
        "content": str(comp.get("description", "")),
        "content_type": "text",
        "start_at": start,
        "end_at": max(end, start),
        "all_day": all_day,
        "recurrence": recurrence,
    }


def _parse_vtodo(comp) -> dict | None:
    dtstart = comp.get("dtstart")
    due = comp.get("due")
    duration = comp.get("duration")
    start = _to_utc(dtstart.dt) if dtstart is not None else None
    end = _to_utc(due.dt) if due is not None else None
    # DTSTART が無く DUE のみなら DUE を開始に充てる
    if start is None and end is not None:
        start = end
    # 終了が無ければ DURATION (無ければ 30 分) で補完する
    if start is not None and end is None:
        mins = int(duration.dt.total_seconds() // 60) if duration is not None else 30
        end = start + timedelta(minutes=mins)
    return {
        "title": str(comp.get("summary", "(no title)")),
        "content": str(comp.get("description", "")),
        "content_type": "text",
        "start_at": start,
        "end_at": end,
        "done": str(comp.get("status", "")) == "COMPLETED",
    }
