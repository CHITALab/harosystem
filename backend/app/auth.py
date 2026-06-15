"""認証ヘルパー (JWT + bcrypt)。

パスワードハッシュ:
  bcrypt ライブラリを直接使用する。passlib は Python 3.12 との互換性問題があるため使わない。

JWT:
  PyJWT でトークンを生成・検証する。署名アルゴリズムは HS256 (対称鍵)。
  鍵は環境変数 JWT_SECRET_KEY から取得する (未設定の場合は起動時にエラー)。
"""

import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from . import models
from .database import get_db

# JWT 設定
JWT_SECRET_KEY = os.environ["JWT_SECRET_KEY"]
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 72  # トークン有効期限 (3 日間)

# FastAPI のセキュリティスキーム (Authorization: Bearer <token>)
_bearer = HTTPBearer()


def hash_password(password: str) -> str:
    """平文パスワードを bcrypt でハッシュ化する"""
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    """平文パスワードとハッシュを照合する"""
    return bcrypt.checkpw(password.encode(), hashed.encode())


def create_access_token(user_id: int, username: str) -> str:
    """JWT アクセストークンを生成する"""
    payload = {
        "sub": str(user_id),
        "username": username,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def get_current_user(
    cred: HTTPAuthorizationCredentials = Depends(_bearer),
    db: Session = Depends(get_db),
) -> models.User:
    """JWT を検証し、対応する User を返す。失敗時は 401 を返す"""
    try:
        payload = jwt.decode(cred.credentials, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_id = int(payload["sub"])
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError, KeyError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="トークンが無効または期限切れです",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.get(models.User, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="ユーザーが見つかりません",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user
