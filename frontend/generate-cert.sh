#!/bin/sh
# --------------------------------------------------------------------------
# 自己署名TLS証明書の生成スクリプト
#
# 開発環境専用。本番環境では Let's Encrypt 等の正式な証明書を使うこと。
# このスクリプトは nginx コンテナ起動時 (/docker-entrypoint.d) に実行される。
# 外部アクセス時は環境変数 CERT_HOSTS にサーバーのホスト名/IP を設定すると
# それらが証明書の SAN に含まれ、ホスト名不一致の警告を防げる。
# --------------------------------------------------------------------------

set -e

CERT_DIR="/etc/nginx/certs"
mkdir -p "${CERT_DIR}"

# 既に証明書が存在する場合はスキップ（ボリュームマウント時の再生成防止）
if [ -f "${CERT_DIR}/server.crt" ] && [ -f "${CERT_DIR}/server.key" ]; then
  echo "[INFO] 証明書は既に存在します。スキップします。"
  exit 0
fi

# subjectAltName を組み立てる。localhost / 127.0.0.1 は常に含め、
# 環境変数 CERT_HOSTS (カンマ区切りのホスト名/IP) を追加する。
# 例: CERT_HOSTS=192.168.1.10,calendar.example.com
SAN="DNS:localhost,IP:127.0.0.1"
CN="localhost"
if [ -n "${CERT_HOSTS}" ]; then
  OLD_IFS=$IFS
  IFS=','
  for h in ${CERT_HOSTS}; do
    h=$(printf '%s' "$h" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')  # 前後空白除去
    [ -z "$h" ] && continue
    # IPv4 (数字.数字.数字.数字) は IP: として、それ以外はホスト名として DNS: に追加する。
    # 用途は LAN 内の別 PC からのアクセス (例: 192.168.1.50 や server.local)。
    if printf '%s' "$h" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
      SAN="${SAN},IP:${h}"
    else
      SAN="${SAN},DNS:${h}"
      CN="$h"   # ホスト名を CN にする (実際の検証は SAN が使われる)
    fi
  done
  IFS=$OLD_IFS
fi

openssl req -x509 -nodes \
  -days 3650 \
  -newkey rsa:2048 \
  -keyout "${CERT_DIR}/server.key" \
  -out    "${CERT_DIR}/server.crt" \
  -subj   "/C=JP/ST=Local/L=Local/O=harosystem/CN=${CN}" \
  -addext "subjectAltName=${SAN}"

echo "[INFO] 自己署名証明書を生成しました (SAN=${SAN})"
