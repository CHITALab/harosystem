#!/bin/sh
# --------------------------------------------------------------------------
# 自己署名TLS証明書の生成スクリプト
#
# 開発環境専用。本番環境では Let's Encrypt 等の正式な証明書を使うこと。
# このスクリプトは docker compose build 時に Dockerfile 内で実行される。
# --------------------------------------------------------------------------

set -e

CERT_DIR="/etc/nginx/certs"
mkdir -p "${CERT_DIR}"

# 既に証明書が存在する場合はスキップ（ボリュームマウント時の再生成防止）
if [ -f "${CERT_DIR}/server.crt" ] && [ -f "${CERT_DIR}/server.key" ]; then
  echo "[INFO] 証明書は既に存在します。スキップします。"
  exit 0
fi

openssl req -x509 -nodes \
  -days 3650 \
  -newkey rsa:2048 \
  -keyout "${CERT_DIR}/server.key" \
  -out    "${CERT_DIR}/server.crt" \
  -subj   "/C=JP/ST=Local/L=Local/O=harosystem/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

echo "[INFO] 自己署名証明書を生成しました: ${CERT_DIR}/server.{crt,key}"
