/**
 * Tailwind 設定 — デザイントークンの定義。
 *
 * 色はすべて CSS 変数 (--c-*) を参照する。変数の実体 (テーマごとの値) は
 * src/styles.scss のテーマブロックで定義しており、html[data-theme] の
 * 切り替えだけでサイト全体の配色が変わる。
 * `rgb(var(--c-x) / <alpha-value>)` 形式にすることで
 * `bg-cyber-cyan/10` のような透過修飾もそのまま使える。
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        cyber: {
          bg: 'rgb(var(--c-bg) / <alpha-value>)', // アプリ全体の背景
          bg2: 'rgb(var(--c-bg2) / <alpha-value>)', // 入力欄・カードの背景
          bg3: 'rgb(var(--c-bg3) / <alpha-value>)',
          panel: 'rgb(var(--c-panel) / 0.92)', // サイドバー/詳細パネル
          cyan: 'rgb(var(--c-cyan) / <alpha-value>)', // 予定 (EVENT) のアクセント
          magenta: 'rgb(var(--c-magenta) / <alpha-value>)', // タスク (TASK) のアクセント
          green: 'rgb(var(--c-green) / <alpha-value>)', // 完了状態
          red: 'rgb(var(--c-red) / <alpha-value>)', // 危険操作・現在時刻ライン
          yellow: 'rgb(var(--c-yellow) / <alpha-value>)',
          text: 'rgb(var(--c-text) / <alpha-value>)', // 基本文字色
          dim: 'rgb(var(--c-dim) / <alpha-value>)', // 補助文字色
          line: 'rgb(var(--c-cyan) / 0.10)', // グリッド罫線 (弱)
          lineStrong: 'rgb(var(--c-cyan) / 0.25)', // グリッド罫線 (強)
        },
      },
      fontFamily: {
        head: ['Orbitron', 'sans-serif'], // 見出し用
        mono: ['"Share Tech Mono"', 'monospace'], // 本文用
      },
      keyframes: {
        // 詳細パネルの右からのスライドイン
        'slide-in': {
          from: { transform: 'translateX(30px)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
      },
      boxShadow: {
        'glow-cyan': '0 0 12px rgb(var(--c-cyan) / 0.35)',
        'glow-cyan-strong': '0 0 40px rgb(var(--c-cyan) / 0.25)',
        'glow-magenta': '0 0 12px rgb(var(--c-magenta) / 0.4)',
        'glow-red': '0 0 12px rgb(var(--c-red) / 0.4)',
      },
    },
  },
  plugins: [],
};
