from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class User(Base):
    """認証ユーザー。将来のマルチユーザー対応のため全リソースの所有者となる"""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(200), nullable=False)


class Label(Base):
    __tablename__ = "labels"
    # マルチユーザー対応: 同一ユーザー内でラベル名がユニーク
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_labels_user_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, default=1
    )
    color: Mapped[str] = mapped_column(String(20), default="#00f0ff")
    # このラベルを付けた予定/タスクの新規作成時に使う通知の既定値
    notify_default: Mapped[bool] = mapped_column(Boolean, default=False)
    notify_before_min_default: Mapped[int] = mapped_column(default=10)

    events: Mapped[list["Event"]] = relationship(back_populates="label")
    tasks: Mapped[list["Task"]] = relationship(back_populates="label")
    notes: Mapped[list["Note"]] = relationship(back_populates="label")


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, default=1
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, default="")
    content_type: Mapped[str] = mapped_column(String(10), default="md")  # md | text
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    # タイル個別の色 (未設定ならラベル色 → 既定色の順でフォールバック)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # 通知: 開始 notify_before_min 分前に 1 回通知する (notified_at で重複送信を防ぐ)
    notify_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    notify_before_min: Mapped[int] = mapped_column(default=10)
    notified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    label_id: Mapped[int | None] = mapped_column(
        ForeignKey("labels.id", ondelete="SET NULL"), nullable=True
    )
    # 繰り返しルール (RRULE 文字列, 例 "FREQ=WEEKLY;BYDAY=MO")。null=単発。
    # 一覧取得時に表示期間へ展開する (マスターのみ保存し、各回は仮想インスタンス)
    recurrence: Mapped[str | None] = mapped_column(String(500), nullable=True)

    label: Mapped[Label | None] = relationship(back_populates="events")


class Feed(Base):
    """外部カレンダー購読 (ICS URL)。定期同期でイベントを取り込む"""

    __tablename__ = "feeds"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, default=1
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    url: Mapped[str] = mapped_column(String(1000), nullable=False)
    color: Mapped[str] = mapped_column(String(20), default="#f5e642")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # 直近の同期エラー (成功時は None)。UI で原因を表示するために保持する
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)

    events: Mapped[list["FeedEvent"]] = relationship(
        back_populates="feed", cascade="all, delete-orphan"
    )


class FeedEvent(Base):
    """購読フィードから取り込んだ予定 (読み取り専用のキャッシュ)"""

    __tablename__ = "feed_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    feed_id: Mapped[int] = mapped_column(
        ForeignKey("feeds.id", ondelete="CASCADE"), nullable=False
    )
    uid: Mapped[str] = mapped_column(String(500), default="")
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, default="")
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    all_day: Mapped[bool] = mapped_column(Boolean, default=False)

    feed: Mapped[Feed] = relationship(back_populates="events")


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, default=1
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, default="")
    content_type: Mapped[str] = mapped_column(String(10), default="md")  # md | text
    # 予定 (Event) と同じく開始/終了時刻で管理する (null/null = 未スケジュール=バックログ)。
    # 旧 due_at / duration_min は廃止 (DB カラムはレガシーとして残置・未使用)。
    start_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    end_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    # カンバンのステータス (backlog | todo | in_progress | done)。done と相互同期する
    # (done == True ⇔ status == "done")。backlog = 期限/着手未定のプール。
    # 詳細は routers/tasks.py を参照
    status: Mapped[str] = mapped_column(String(20), default="todo")
    # タイル個別の色 (未設定ならラベル色 → 既定色の順でフォールバック)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # 通知: 期限 notify_before_min 分前に 1 回通知する
    notify_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    notify_before_min: Mapped[int] = mapped_column(default=10)
    notified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    label_id: Mapped[int | None] = mapped_column(
        ForeignKey("labels.id", ondelete="SET NULL"), nullable=True
    )
    # 紐付くノート (任意)。ノート削除時は SET NULL でタスク自体は残す
    note_id: Mapped[int | None] = mapped_column(
        ForeignKey("notes.id", ondelete="SET NULL"), nullable=True
    )
    # 所属スプリント (null = バックログプール)。スプリント削除時は SET NULL でプールへ戻る
    sprint_id: Mapped[int | None] = mapped_column(
        ForeignKey("sprints.id", ondelete="SET NULL"), nullable=True
    )

    label: Mapped[Label | None] = relationship(back_populates="tasks")
    note: Mapped["Note | None"] = relationship(back_populates="tasks")
    sprint: Mapped["Sprint | None"] = relationship(back_populates="tasks")


class Sprint(Base):
    """スプリント (実行期間)。タスクをまとめて計画・進行するための単位。

    Jira 風のバックログ/スプリント管理で使う。同時に active なスプリントは 1 つ。
    バックログ (sprint_id IS NULL) からタスクをスプリントへ割り当てて計画する。
    """

    __tablename__ = "sprints"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, default=1
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # planned (未開始) | active (進行中) | completed (完了)
    state: Mapped[str] = mapped_column(String(20), default="planned")
    start_date: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    end_date: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    tasks: Mapped[list["Task"]] = relationship(back_populates="sprint")


class Note(Base):
    """プロジェクト (Label) に紐づく Markdown ノート。

    1 回で終わらないタスクや調査メモを横断的に 1 箇所へまとめるための機能。
    Label (1) 対 Note (多) / Note (1) 対 Task (多) の関係を持つ。
    """

    __tablename__ = "notes"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, default=1
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, default="")
    content_type: Mapped[str] = mapped_column(String(10), default="md")  # md | text
    # 紐づくプロジェクト (任意)。ラベル削除時は SET NULL でノート自体は残す
    label_id: Mapped[int | None] = mapped_column(
        ForeignKey("labels.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    label: Mapped[Label | None] = relationship(back_populates="notes")
    # ノートに紐づくタスク (Note 1:N Task)。削除時は note_id を SET NULL する
    tasks: Mapped[list["Task"]] = relationship(back_populates="note")


class Webhook(Base):
    """通知の送信先 (Discord / Slack の Incoming Webhook URL)"""

    __tablename__ = "webhooks"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, default=1
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)  # discord | slack
    url: Mapped[str] = mapped_column(String(1000), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
