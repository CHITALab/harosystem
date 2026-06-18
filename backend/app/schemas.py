"""Pydantic スキーマ (API の入出力契約)。

バリデーション方針 (セキュアコーディング):
  - 色は #rrggbb 形式のみ受け付ける (style 属性へ流れるため厳格に)
  - URL は http/https のみ。webcal:// は https:// に自動変換して受ける
  - 数値 (作業時間/通知タイミング) は妥当な範囲に制限する
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# #rrggbb (3 桁短縮形は揺れの元なので受けない)
HEX_COLOR = r"^#[0-9a-fA-F]{6}$"


def _validate_http_url(url: str) -> str:
    """http/https のみ許可。webcal:// (カレンダー購読の慣習) は https に読み替える"""
    url = url.strip()
    if url.startswith("webcal://"):
        url = "https://" + url[len("webcal://") :]
    if not (url.startswith("https://") or url.startswith("http://")):
        raise ValueError("URL は http:// または https:// で始まる必要があります")
    return url


# ---- Label ----
class LabelBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    color: str = Field(default="#00f0ff", pattern=HEX_COLOR)
    # ラベル既定の通知設定 (新規作成フォームの初期値に使う)
    notify_default: bool = False
    notify_before_min_default: int = Field(default=10, ge=0, le=10_080)


class LabelCreate(LabelBase):
    pass


class LabelOut(LabelBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


# ---- Event ----
class EventBase(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(default="", max_length=100_000)
    content_type: Literal["md", "text"] = "md"
    start_at: datetime
    end_at: datetime
    all_day: bool = False
    color: str | None = Field(default=None, pattern=HEX_COLOR)
    notify_enabled: bool = False
    notify_before_min: int = Field(default=10, ge=0, le=10_080)  # 最長 1 週間前
    label_id: int | None = None


class EventCreate(EventBase):
    pass


class EventUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = Field(default=None, max_length=100_000)
    content_type: Literal["md", "text"] | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    all_day: bool | None = None
    color: str | None = Field(default=None, pattern=HEX_COLOR)
    notify_enabled: bool | None = None
    notify_before_min: int | None = Field(default=None, ge=0, le=10_080)
    label_id: int | None = None


class EventOut(EventBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    label: LabelOut | None = None


# ---- Feed (外部カレンダー購読) ----
class FeedBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    url: str = Field(min_length=1, max_length=1000)
    color: str = Field(default="#f5e642", pattern=HEX_COLOR)
    enabled: bool = True

    @field_validator("url")
    @classmethod
    def check_url(cls, v: str) -> str:
        return _validate_http_url(v)


class FeedCreate(FeedBase):
    pass


class FeedUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    url: str | None = Field(default=None, min_length=1, max_length=1000)
    color: str | None = Field(default=None, pattern=HEX_COLOR)
    enabled: bool | None = None

    @field_validator("url")
    @classmethod
    def check_url(cls, v: str | None) -> str | None:
        return _validate_http_url(v) if v is not None else None


class FeedOut(FeedBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    last_synced_at: datetime | None = None
    last_error: str | None = None


class FeedEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    feed_id: int
    title: str
    content: str
    start_at: datetime
    end_at: datetime
    all_day: bool
    feed: FeedOut


class IcsImportResult(BaseModel):
    """ICS インポートの取り込み件数"""

    events: int
    tasks: int


# ---- Task ----
class TaskBase(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(default="", max_length=100_000)
    content_type: Literal["md", "text"] = "md"
    due_at: datetime | None = None
    duration_min: int | None = Field(default=None, ge=1, le=1440)
    done: bool = False
    color: str | None = Field(default=None, pattern=HEX_COLOR)
    notify_enabled: bool = False
    notify_before_min: int = Field(default=10, ge=0, le=10_080)
    label_id: int | None = None
    note_id: int | None = None  # 紐付くノート (任意)


class TaskCreate(TaskBase):
    pass


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = Field(default=None, max_length=100_000)
    content_type: Literal["md", "text"] | None = None
    due_at: datetime | None = None
    duration_min: int | None = Field(default=None, ge=1, le=1440)
    done: bool | None = None
    color: str | None = Field(default=None, pattern=HEX_COLOR)
    notify_enabled: bool | None = None
    notify_before_min: int | None = Field(default=None, ge=0, le=10_080)
    label_id: int | None = None
    note_id: int | None = None


class TaskOut(TaskBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    label: LabelOut | None = None


# ---- Note (プロジェクトに紐づく Markdown ノート) ----
class NoteBase(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(default="", max_length=100_000)
    content_type: Literal["md", "text"] = "md"
    label_id: int | None = None


class NoteCreate(NoteBase):
    pass


class NoteUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = Field(default=None, max_length=100_000)
    content_type: Literal["md", "text"] | None = None
    label_id: int | None = None


class NoteOut(NoteBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    label: LabelOut | None = None
    created_at: datetime
    updated_at: datetime
    # 紐づくタスク件数 (一覧表示用。ルーターで集計して埋める)
    task_count: int = 0


# ---- Webhook (通知の送信先) ----
class WebhookBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    kind: Literal["discord", "slack"]
    url: str = Field(min_length=1, max_length=1000)
    enabled: bool = True

    @field_validator("url")
    @classmethod
    def check_url(cls, v: str) -> str:
        v = _validate_http_url(v)
        if not v.startswith("https://"):
            raise ValueError("Webhook URL は https:// である必要があります")
        return v


class WebhookCreate(WebhookBase):
    pass


class WebhookUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    kind: Literal["discord", "slack"] | None = None
    url: str | None = Field(default=None, min_length=1, max_length=1000)
    enabled: bool | None = None

    @field_validator("url")
    @classmethod
    def check_url(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = _validate_http_url(v)
        if not v.startswith("https://"):
            raise ValueError("Webhook URL は https:// である必要があります")
        return v


class WebhookOut(WebhookBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
