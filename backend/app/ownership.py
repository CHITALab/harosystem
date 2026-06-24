"""所有権チェック (IDOR 防止) の共通ヘルパー。

タスク/予定/ノート等が他リソース (ラベル・ノート・スプリント) を ID で参照する際、
その参照先が「ログイン中ユーザーの所有物」であることを必ず確認する。
他人の ID を指定して紐付ける越境 (IDOR) を防ぐ。
"""

from fastapi import HTTPException
from sqlalchemy.orm import Session

from . import models


def assert_owned(
    db: Session, user_id: int, model: type, obj_id: int | None, name: str
) -> None:
    """obj_id が user_id の所有するリソースであることを確認する。

    obj_id が None (未指定 / 解除) の場合は何もしない。
    所有していない / 存在しない場合は 404 を投げる。
    """
    if obj_id is None:
        return
    obj = db.get(model, obj_id)
    if obj is None or getattr(obj, "user_id", None) != user_id:
        raise HTTPException(404, f"指定された{name}が見つかりません")


def assert_label(db: Session, user_id: int, label_id: int | None) -> None:
    assert_owned(db, user_id, models.Label, label_id, "ラベル")


def assert_note(db: Session, user_id: int, note_id: int | None) -> None:
    assert_owned(db, user_id, models.Note, note_id, "ノート")


def assert_sprint(db: Session, user_id: int, sprint_id: int | None) -> None:
    assert_owned(db, user_id, models.Sprint, sprint_id, "スプリント")
