/**
 * アプリ内通知 — 通知 ON の予定/タスクの「開始/期限 N 分前」に
 * ブラウザ通知 (Notification API) + トーストで知らせる。
 *
 * Discord/Slack への送信はバックエンド (app/notify.py) が行うため、
 * ここではブラウザが開いているときの画面上の通知のみを担当する。
 * 二重通知防止はタブ内の Set で行う (バックエンド側とは独立)。
 */
import { Injectable, OnDestroy, inject } from '@angular/core';
import { StoreService } from './store.service';
import { ToastService } from './toast.service';

const CHECK_INTERVAL_MS = 30_000;
/** 通知時刻からこれ以上経過していたら出さない (起動直後の過去分一斉通知を防ぐ) */
const STALE_MS = 60 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class NotificationService implements OnDestroy {
  private store = inject(StoreService);
  private toast = inject(ToastService);

  /** このタブで通知済みのキー ("event-3-<start>" 形式) */
  private notified = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  /** アプリ起動時に呼ぶ。通知許可の取得は通知を使う設定の時だけ行う */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS);
    this.check();
  }

  /** ブラウザ通知の許可を求める (設定画面のボタンから呼ばれる) */
  async requestPermission(): Promise<boolean> {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    return (await Notification.requestPermission()) === 'granted';
  }

  private check(): void {
    const now = Date.now();

    for (const ev of this.store.events()) {
      if (!ev.notify_enabled) continue;
      const at = new Date(ev.start_at).getTime() - ev.notify_before_min * 60_000;
      this.fire(`event-${ev.id}-${ev.start_at}`, at, now, `📅 ${ev.title}`, 'まもなく開始します');
    }
    for (const t of this.store.tasks()) {
      if (!t.notify_enabled || t.done || !t.start_at) continue;
      const at = new Date(t.start_at).getTime() - t.notify_before_min * 60_000;
      this.fire(`task-${t.id}-${t.start_at}`, at, now, `✅ ${t.title}`, 'まもなく開始します');
    }
  }

  /** 通知時刻 at を過ぎていて未通知ならブラウザ通知 + トーストを出す */
  private fire(key: string, at: number, now: number, title: string, body: string): void {
    if (now < at || now > at + STALE_MS || this.notified.has(key)) return;
    this.notified.add(key);
    this.toast.info(`${title} — ${body}`);
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, tag: key });
    }
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
