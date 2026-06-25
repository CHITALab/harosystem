# --------------------------------------------------------------------------
# フロントエンド Dockerfile — マルチステージビルド
#
# ステージ 1 (build):
#   Node.js 環境で Angular アプリをビルドし、静的ファイルを生成する。
#
# ステージ 2 (runtime):
#   Nginx で静的ファイルを配信する。
#   自己署名 TLS 証明書を生成して HTTPS に対応。
#
# ビルド手順:
#   docker compose build frontend
# --------------------------------------------------------------------------

# ── ステージ 1: ビルド ──
FROM node:20-alpine AS build

WORKDIR /app

# 依存関係のインストール (package.json だけ先にコピーしてキャッシュを活かす)
COPY package.json ./
RUN npm install

# ソースコードをコピーしてビルド
COPY angular.json tsconfig.json tsconfig.app.json tailwind.config.js ./
COPY src ./src
RUN npm run build

# ── ステージ 2: 実行環境 ──
FROM nginx:alpine

# openssl をインストール (自己署名証明書の生成に必要)
RUN apk add --no-cache openssl

# 証明書生成スクリプトを nginx エントリポイントに配置する。
# ビルド時ではなくコンテナ起動時に実行することで、環境変数 CERT_HOSTS
# (外部アクセス用のホスト名/IP) を SAN に反映できる。
COPY generate-cert.sh /docker-entrypoint.d/00-generate-cert.sh
RUN chmod +x /docker-entrypoint.d/00-generate-cert.sh

# Angular ビルド成果物をコピー
COPY --from=build /app/dist/harosystem/browser /usr/share/nginx/html

# Nginx 設定ファイルをコピー
COPY nginx.conf /etc/nginx/conf.d/default.conf

# HTTP (80) + HTTPS (443) を公開
EXPOSE 80 443
