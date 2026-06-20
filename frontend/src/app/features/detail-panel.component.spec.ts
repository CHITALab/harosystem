/**
 * DetailPanelComponent のテスト。
 * 中核機能「md 内チェックボックスのクリック → 本文を書き換えて保存」を
 * 実際の DOM クリックで検証する。
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiService } from '../core/api.service';
import { StoreService } from '../core/store.service';
import { EventItem, TaskItem } from '../core/models';
import { DetailPanelComponent } from './detail-panel.component';

const baseEvent: EventItem = {
  id: 1,
  title: 'ミーティング',
  content: '- [ ] 資料準備\n- [x] 会議室予約',
  content_type: 'md',
  start_at: '2026-06-11T09:00:00Z',
  end_at: '2026-06-11T10:00:00Z',
  all_day: false,
  label_id: null,
  label: null,
};

const baseTask: TaskItem = {
  id: 2,
  title: '買い出し',
  content: '- [ ] 牛乳',
  content_type: 'md',
  start_at: '2026-06-11T12:00:00Z',
  end_at: '2026-06-11T13:00:00Z',
  done: false,
  label_id: null,
  label: null,
};

describe('DetailPanelComponent', () => {
  let fixture: ComponentFixture<DetailPanelComponent>;
  let component: DetailPanelComponent;
  let api: {
    updateEvent: jest.Mock;
    updateTask: jest.Mock;
    getEvents: jest.Mock;
    getTasks: jest.Mock;
    getLabels: jest.Mock;
    getFeedEvents: jest.Mock;
  };

  beforeEach(() => {
    api = {
      updateEvent: jest.fn((id: number, data: object) => of({ ...baseEvent, ...data })),
      updateTask: jest.fn((id: number, data: object) => of({ ...baseTask, ...data })),
      getEvents: jest.fn().mockReturnValue(of([])),
      getTasks: jest.fn().mockReturnValue(of([])),
      getLabels: jest.fn().mockReturnValue(of([])),
      getFeedEvents: jest.fn().mockReturnValue(of([])),
    };
    TestBed.configureTestingModule({
      imports: [DetailPanelComponent],
      providers: [{ provide: ApiService, useValue: api }],
    });
    fixture = TestBed.createComponent(DetailPanelComponent);
    component = fixture.componentInstance;
  });

  const render = (selected: DetailPanelComponent['selected']): void => {
    component.selected = selected;
    fixture.detectChanges();
  };

  const mdCheckboxes = (): HTMLInputElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.md input[type="checkbox"]'));

  it('md のチェックボックスがクリック可能 (disabled でない) 状態で描画される', () => {
    render({ kind: 'event', item: baseEvent });
    const boxes = mdCheckboxes();
    expect(boxes.length).toBe(2);
    expect(boxes.every((b) => !b.disabled)).toBe(true);
    expect(boxes[0].checked).toBe(false);
    expect(boxes[1].checked).toBe(true);
  });

  it('予定: 未チェックをクリックすると [ ] → [x] で保存される', () => {
    render({ kind: 'event', item: baseEvent });
    mdCheckboxes()[0].click();
    expect(api.updateEvent).toHaveBeenCalledWith(1, {
      content: '- [x] 資料準備\n- [x] 会議室予約',
    });
  });

  it('予定: チェック済みをクリックすると [x] → [ ] に戻る', () => {
    render({ kind: 'event', item: baseEvent });
    mdCheckboxes()[1].click();
    expect(api.updateEvent).toHaveBeenCalledWith(1, {
      content: '- [ ] 資料準備\n- [ ] 会議室予約',
    });
  });

  it('タスク: md チェックボックスは updateTask で保存される', () => {
    render({ kind: 'task', item: baseTask });
    mdCheckboxes()[0].click();
    expect(api.updateTask).toHaveBeenCalledWith(2, { content: '- [x] 牛乳' });
  });

  it('保存後は詳細パネルの内容 (store.selected) も更新される', () => {
    render({ kind: 'event', item: baseEvent });
    mdCheckboxes()[0].click();
    const store = TestBed.inject(StoreService);
    const sel = store.selected();
    expect(sel?.kind).toBe('event');
    expect(sel?.item.content).toBe('- [x] 資料準備\n- [x] 会議室予約');
  });

  it('タスクの完了トグルで done が反転して保存される', () => {
    render({ kind: 'task', item: baseTask });
    const doneBox: HTMLInputElement =
      fixture.nativeElement.querySelector('label input[type="checkbox"]');
    doneBox.dispatchEvent(new Event('change'));
    expect(api.updateTask).toHaveBeenCalledWith(2, { done: true });
  });

  it('枠色: 予定はシアン / タスクはマゼンタ', () => {
    render({ kind: 'event', item: baseEvent });
    const aside = (): HTMLElement => fixture.nativeElement.querySelector('aside');
    expect(aside().classList).toContain('border-cyber-cyan');

    render({ kind: 'task', item: baseTask });
    expect(aside().classList).toContain('border-cyber-magenta');
  });
});
