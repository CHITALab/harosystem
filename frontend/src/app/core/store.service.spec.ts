/**
 * StoreService のユニットテスト。
 * ApiService はモックに差し替え、Signals の状態遷移だけを検証する。
 */
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiService } from './api.service';
import { StoreService } from './store.service';
import { EventItem, TaskItem } from './models';
import { startOfDay } from './util';

const event = (id: number, over: Partial<EventItem> = {}): EventItem => ({
  id,
  title: `event-${id}`,
  content: '',
  content_type: 'md',
  start_at: '2026-06-11T09:00:00Z',
  end_at: '2026-06-11T10:00:00Z',
  all_day: false,
  label_id: null,
  label: null,
  ...over,
});

const task = (id: number, over: Partial<TaskItem> = {}): TaskItem => ({
  id,
  title: `task-${id}`,
  content: '',
  content_type: 'md',
  due_at: '2026-06-11T12:00:00Z',
  duration_min: null,
  done: false,
  label_id: null,
  label: null,
  ...over,
});

describe('StoreService', () => {
  let store: StoreService;
  let api: {
    getLabels: jest.Mock;
    getEvents: jest.Mock;
    getTasks: jest.Mock;
    getFeeds: jest.Mock;
    getFeedEvents: jest.Mock;
  };

  beforeEach(() => {
    api = {
      getLabels: jest.fn().mockReturnValue(of([])),
      getEvents: jest.fn().mockReturnValue(of([event(1)])),
      getTasks: jest.fn().mockReturnValue(of([task(1)])),
      getFeeds: jest.fn().mockReturnValue(of([])),
      getFeedEvents: jest.fn().mockReturnValue(of([])),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: api }],
    });
    store = TestBed.inject(StoreService);
    // テストを日付に依存させないため基準日を固定 (2026-06-11 木曜)
    store.anchor.set(new Date(2026, 5, 11));
  });

  describe('range (表示期間の導出)', () => {
    it('day: その日 1 日', () => {
      store.viewMode.set('day');
      const [s, e] = store.range();
      expect(s).toEqual(new Date(2026, 5, 11));
      expect(e).toEqual(new Date(2026, 5, 12));
    });

    it('week: 日曜起点の 7 日間', () => {
      store.viewMode.set('week');
      const [s, e] = store.range();
      expect(s).toEqual(new Date(2026, 5, 7)); // 日曜
      expect(e).toEqual(new Date(2026, 5, 14));
    });

    it('month: 1日を含む週の日曜から 42 日間', () => {
      store.viewMode.set('month');
      const [s, e] = store.range();
      expect(s.getDay()).toBe(0);
      expect(s <= new Date(2026, 5, 1)).toBe(true);
      expect((e.getTime() - s.getTime()) / 86400000).toBe(42);
    });
  });

  describe('navigate', () => {
    it('day: ±1 日移動する', () => {
      store.viewMode.set('day');
      store.navigate(1);
      expect(store.anchor()).toEqual(new Date(2026, 5, 12));
      store.navigate(-1);
      expect(store.anchor()).toEqual(new Date(2026, 5, 11));
    });

    it('week: ±7 日移動する', () => {
      store.viewMode.set('week');
      store.navigate(1);
      expect(store.anchor()).toEqual(new Date(2026, 5, 18));
    });

    it('month: 翌月の 1 日へ移動する', () => {
      store.viewMode.set('month');
      store.navigate(1);
      expect(store.anchor()).toEqual(new Date(2026, 6, 1));
    });

    it('0 で今日へ戻る', () => {
      store.navigate(0);
      expect(store.anchor()).toEqual(startOfDay(new Date()));
    });

    it('移動のたびにデータを再取得する', () => {
      store.navigate(1);
      expect(api.getEvents).toHaveBeenCalled();
      expect(api.getTasks).toHaveBeenCalled();
    });
  });

  describe('setFilter (ラベル絞り込み)', () => {
    it('設定 → 同じ ID をもう一度でトグル解除', () => {
      store.setFilter(3);
      expect(store.filterLabelId()).toBe(3);
      store.setFilter(3);
      expect(store.filterLabelId()).toBeNull();
    });

    it('別の ID なら切り替わる', () => {
      store.setFilter(3);
      store.setFilter(5);
      expect(store.filterLabelId()).toBe(5);
    });
  });

  describe('reload', () => {
    it('API の結果が signals に反映される', () => {
      store.reload();
      expect(store.events()).toEqual([event(1)]);
      expect(store.tasks()).toEqual([task(1)]);
    });

    it('外部カレンダーの予定も同時に再取得する', () => {
      store.reload();
      expect(api.getFeedEvents).toHaveBeenCalled();
    });
  });

  describe('syncSelected (パネル外からの更新の同期)', () => {
    it('選択中アイテムと同じなら詳細パネルも更新する', () => {
      store.select({ kind: 'task', item: task(1) });
      const updated = task(1, { done: true });
      store.syncSelected('task', updated);
      expect(store.selected()).toEqual({ kind: 'task', item: updated });
    });

    it('選択中と別のアイテムならパネルは変えずデータのみ再取得', () => {
      store.select({ kind: 'task', item: task(1) });
      api.getEvents.mockClear();
      store.syncSelected('task', task(2, { done: true }));
      expect(store.selected()).toEqual({ kind: 'task', item: task(1) });
      expect(api.getEvents).toHaveBeenCalled();
    });

    it('kind が違えばパネルは更新しない', () => {
      store.select({ kind: 'event', item: event(1) });
      store.syncSelected('task', task(1));
      expect(store.selected()).toEqual({ kind: 'event', item: event(1) });
    });
  });

  describe('form モーダル', () => {
    it('openForm / closeForm', () => {
      store.openForm({ kind: 'event' });
      expect(store.form()).toEqual({ kind: 'event' });
      store.closeForm();
      expect(store.form()).toBeNull();
    });
  });
});
