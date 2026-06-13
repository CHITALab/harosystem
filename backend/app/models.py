from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Label(Base):
    __tablename__ = "labels"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    color: Mapped[str] = mapped_column(String(20), default="#00f0ff")
    # このラベルを付けた予定/タスクの新規作成時に使う通知の既定値
    notify_default: Mapped[bool] = mapped_column(Boolean, default=False)
    notify_before_min_default: Mapped[int] = mapped_column(default=10)

    events: Mapped[list["Event"]] = relationship(back_populates="label")
    tasks: Mapped[list["Task"]] = relationship(back_populates="label")


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(primary_key=True)
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

    label: Mapped[Label | None] = relationship(back_populates="events")


class Feed(Base):
    """外部カレンダー購読 (ICS URL)。定期同期でイベントを取り込む"""

    __tablename__ = "feeds"

    id: Mapped[int] = mapped_column(primary_key=True)
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
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, default="")
    content_type: Mapped[str] = mapped_column(String(10), default="md")  # md | text
    due_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    duration_min: Mapped[int | None] = mapped_column(nullable=True)
    done: Mapped[bool] = mapped_column(Boolean, default=False)
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

    label: Mapped[Label | None] = relationship(back_populates="tasks")


class Webhook(Base):
    """通知の送信先 (Discord / Slack の Incoming Webhook URL)"""

    __tablename__ = "webhooks"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)  # discord | slack
    url: Mapped[str] = mapped_column(String(1000), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
