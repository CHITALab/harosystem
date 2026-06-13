/**
 * ApiService のユニットテスト。
 * HttpTestingController で実際の HTTP リクエスト (URL / メソッド / パラメータ /
 * ボディ) が正しく組み立てられているかを検証する。
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ApiService } from './api.service';

describe('ApiService', () => {
  let api: ApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify()); // 予期しないリクエストが無いことを保証

  it('getLabels: GET /api/labels', () => {
    api.getLabels().subscribe();
    httpMock.expectOne('/api/labels').flush([]);
  });

  it('getEvents: 期間を ISO 文字列でクエリに載せる', () => {
    const start = new Date('2026-06-07T00:00:00Z');
    const end = new Date('2026-06-14T00:00:00Z');
    api.getEvents(start, end, null).subscribe();

    const req = httpMock.expectOne((r) => r.url === '/api/events');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('start')).toBe(start.toISOString());
    expect(req.request.params.get('end')).toBe(end.toISOString());
    expect(req.request.params.has('label_id')).toBe(false); // null なら付けない
    req.flush([]);
  });

  it('getEvents: labelId 指定で label_id が付く', () => {
    api.getEvents(new Date(), new Date(), 7).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/events');
    expect(req.request.params.get('label_id')).toBe('7');
    req.flush([]);
  });

  it('getTasks: include_no_due=true 付きで取得する', () => {
    api.getTasks(new Date(), new Date(), null).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/tasks');
    expect(req.request.params.get('include_no_due')).toBe('true');
    req.flush([]);
  });

  it('updateTask: PUT /api/tasks/:id に部分更新ボディを送る', () => {
    api.updateTask(3, { done: true }).subscribe();
    const req = httpMock.expectOne('/api/tasks/3');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ done: true });
    req.flush({});
  });

  it('updateEvent: PUT /api/events/:id', () => {
    api.updateEvent(5, { title: 'x' }).subscribe();
    const req = httpMock.expectOne('/api/events/5');
    expect(req.request.method).toBe('PUT');
    req.flush({});
  });

  it('importIcs: ファイルを multipart で POST する', () => {
    const file = new File(['BEGIN:VCALENDAR'], 'cal.ics', { type: 'text/calendar' });
    api.importIcs(file).subscribe();
    const req = httpMock.expectOne('/api/ics/import');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBeInstanceOf(FormData);
    expect((req.request.body as FormData).get('file')).toBe(file);
    req.flush({ events: 1, tasks: 0 });
  });

  it('getFeedEvents: 期間付きで取得する', () => {
    const start = new Date('2026-06-07T00:00:00Z');
    const end = new Date('2026-06-14T00:00:00Z');
    api.getFeedEvents(start, end).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/feeds/events');
    expect(req.request.params.get('start')).toBe(start.toISOString());
    req.flush([]);
  });

  it('syncFeed: POST /api/feeds/:id/sync', () => {
    api.syncFeed(4).subscribe();
    const req = httpMock.expectOne('/api/feeds/4/sync');
    expect(req.request.method).toBe('POST');
    req.flush({});
  });

  it('createFeed / updateFeed / deleteFeed', () => {
    api.createFeed({ name: 'x', url: 'https://e/x.ics' }).subscribe();
    httpMock.expectOne('/api/feeds').flush({});
    api.updateFeed(1, { enabled: false }).subscribe();
    const put = httpMock.expectOne('/api/feeds/1');
    expect(put.request.method).toBe('PUT');
    put.flush({});
    api.deleteFeed(1).subscribe();
    const del = httpMock.expectOne('/api/feeds/1');
    expect(del.request.method).toBe('DELETE');
    del.flush(null);
  });

  it('deleteEvent / deleteLabel: DELETE', () => {
    api.deleteEvent(1).subscribe();
    httpMock.expectOne('/api/events/1').flush(null);
    api.deleteLabel(2).subscribe();
    const req = httpMock.expectOne('/api/labels/2');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });
});
